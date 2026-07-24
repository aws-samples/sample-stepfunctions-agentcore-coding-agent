#!/usr/bin/env python3
"""Seed the coding demo's Aurora pgvector database from the sample CSVs.

Creates the four-table autocoding schema (pgvector extension +
dictionary_terms / synonym_list / terms_not_to_autocode / study_terms),
loads the fixture CSVs from data/, generates Titan Text Embeddings v2
vectors for each dictionary row, and stores them back - all through the
RDS Data API, so it runs from any machine with AWS credentials and no VPC
or database connectivity.

This is a stand-in for the eventual CDC -> Lambda -> embedding pipeline
(deferred): for now embeddings are written by this local script.
Re-running is safe - the script drops and recreates the tables.

Data provenance: the study/site/subject identifiers and free-text
verbatims in the CSVs are fabricated. The dictionary entries are a
de minimis illustrative set showing the shape of MedDRA and WHODrug
records (both proprietary, licensed dictionaries) - this is NOT a
redistributable dictionary extract and includes no customer or patient
data. See data/generate_sample_data.py.

Usage:
    python3 scripts/seed.py [--region REGION] [--stack MedicalCodingAgentCoreDemo]

Requires: boto3, AWS credentials with cloudformation:DescribeStacks,
rds-data:ExecuteStatement, secretsmanager:GetSecretValue (via the Data API),
and bedrock:InvokeModel on amazon.titan-embed-text-v2:0.
"""

import argparse
import csv
import json
import os
import sys
import time

import boto3

EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0"
EMBEDDING_DIMENSIONS = 1024

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

DICTIONARY_CSVS = ["dictionary_terms_meddra.csv", "dictionary_terms_whodrug.csv"]
SYNONYM_CSV = "synonym_list.csv"
TNA_CSV = "terms_not_to_autocode.csv"
STUDY_TERMS_CSV = "study_terms_input.csv"

# Ported from the blog's data/schema.sql: one Aurora instance stores BOTH the
# relational reference data AND its embedding vectors (an extra vector column
# on dictionary_terms), so the agent's semantic search runs against the same
# database the study data lives in.
SCHEMA_STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    "DROP TABLE IF EXISTS study_terms",
    "DROP TABLE IF EXISTS synonym_list",
    "DROP TABLE IF EXISTS terms_not_to_autocode",
    "DROP TABLE IF EXISTS dictionary_terms",
    # 1) Dictionary terms (the controlled vocabulary we code AGAINST).
    #    hierarchy JSONB captures the dictionary path (MedDRA
    #    SOC->HLGT->HLT->PT, or WHODrug ATC1->ATC4).
    f"""
    CREATE TABLE dictionary_terms (
        record_id            TEXT PRIMARY KEY,
        dictionary           TEXT NOT NULL,          -- 'MedDRA' | 'WHODrug'
        dictionary_version   TEXT NOT NULL,          -- e.g. 'v27.0', 'GLOBAL-2024'
        dict_term            TEXT NOT NULL,
        dict_term_type       TEXT,                   -- MedDRA: LLT|PT ; WHODrug: trade name|generic name
        dict_term_code       TEXT NOT NULL,
        dict_term_id         TEXT,
        derivation           TEXT,                   -- WHODrug: generic/ingredient name(s)
        hierarchy            JSONB,                  -- full dictionary path
        is_prior_index       BOOLEAN DEFAULT FALSE,  -- historical mapping, excluded from autocode
        verbatim_text        TEXT,                   -- normalized: lowercased, punctuation -> space
        verbatim_text_embedding VECTOR({EMBEDDING_DIMENSIONS}),
        last_modified_ts     BIGINT,
        created_at_ts        BIGINT
    )
    """,
    "CREATE INDEX ON dictionary_terms (dictionary, dictionary_version)",
    "CREATE INDEX ON dictionary_terms (lower(verbatim_text))",
    # Approximate-nearest-neighbor index for cosine distance (<=>)
    """
    CREATE INDEX dictionary_terms_embedding_hnsw
        ON dictionary_terms USING hnsw (verbatim_text_embedding vector_cosine_ops)
    """,
    # 2) Synonym list (curated verbatim -> real dictionary encoding). Widens
    #    "exact match": a human-curated row lets a non-obvious verbatim
    #    (e.g. 'Hypothyroid') exact-match a real code.
    """
    CREATE TABLE synonym_list (
        record_id            TEXT PRIMARY KEY,
        dictionary           TEXT NOT NULL,
        dictionary_version   TEXT NOT NULL,
        verbatim             TEXT NOT NULL,          -- the free-text people actually type
        dict_term            TEXT NOT NULL,
        dict_term_type       TEXT,
        dict_term_code       TEXT NOT NULL,
        dict_term_id         TEXT,
        derivation           TEXT,
        hierarchy            JSONB,
        status               TEXT DEFAULT 'active',  -- active | pending_review | rejected
        changed_by           TEXT,
        last_modified_ts     BIGINT,
        created_at_ts        BIGINT
    )
    """,
    "CREATE INDEX ON synonym_list (dictionary, dictionary_version, lower(verbatim))",
    # 3) Terms not to autocode (a BLOCK-list, checked FIRST). An exact
    #    verbatim hit here means: never auto-assign - leave for a human coder.
    """
    CREATE TABLE terms_not_to_autocode (
        record_id            TEXT PRIMARY KEY,
        dictionary           TEXT NOT NULL,
        verbatim             TEXT NOT NULL,
        status               TEXT DEFAULT 'active',
        changed_by           TEXT,
        last_modified_ts     BIGINT,
        created_at_ts        BIGINT
    )
    """,
    "CREATE INDEX ON terms_not_to_autocode (dictionary, lower(verbatim))",
    # 4) Study terms (the INPUT verbatims to encode, and the OUTPUT after
    #    coding - the same row is updated in place; status tracks lifecycle).
    """
    CREATE TABLE study_terms (
        record_id            TEXT PRIMARY KEY,       -- composite: study;source;site;subject;...
        source_study         TEXT NOT NULL,
        source_domain        TEXT,                   -- 'AE' (adverse event) | 'CM' (con-med)
        verbatim             TEXT NOT NULL,          -- free text from EDC / clinical DB
        encoding_dictionary  TEXT NOT NULL,          -- 'MedDRA' | 'WHODrug'
        encoding_dictionary_version TEXT NOT NULL,
        from_source          TEXT,                   -- 'EDC' | 'CDB'
        derivation_only      BOOLEAN DEFAULT FALSE,  -- WHODrug/EDC: fill derivation only on 1:1 match
        -- ---- coding output (filled by the workflow) ----
        status               TEXT DEFAULT 'open',    -- open|autocoded|approval_required|approved|rejected
        status_changed_by    TEXT,                   -- 'autocoding-workflow' for machine-coded
        dict_term            TEXT,
        dict_term_type       TEXT,
        dict_term_code       TEXT,
        derivation           TEXT,
        hierarchy            JSONB,
        match_score          NUMERIC(4,3),           -- 0.000 - 1.000 (semantic path only)
        last_encoded_ts      BIGINT,
        created_at_ts        BIGINT
    )
    """,
    "CREATE INDEX ON study_terms (status)",
    "CREATE INDEX ON study_terms (source_study, source_domain)",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default=None, help="AWS region (default: SDK default)")
    parser.add_argument("--stack", default="MedicalCodingAgentCoreDemo", help="CloudFormation stack name")
    args = parser.parse_args()

    session = boto3.Session(region_name=args.region)
    outputs = stack_outputs(session, args.stack)
    cluster_arn = outputs["DbClusterArn"]
    secret_arn = outputs["DbSecretArn"]
    database = outputs["DbName"]
    print(f"Cluster: {cluster_arn}\nDatabase: {database}")

    rds_data = session.client("rds-data")
    bedrock = session.client("bedrock-runtime")

    def execute(sql: str, parameters: list | None = None) -> dict:
        return execute_with_wakeup(rds_data, cluster_arn, secret_arn, database, sql, parameters)

    print("Creating schema (drop + recreate)...")
    for statement in SCHEMA_STATEMENTS:
        execute(statement)

    print("Inserting dictionary rows and generating embeddings...")
    dictionary_rows = 0
    for csv_name in DICTIONARY_CSVS:
        for row in read_csv(csv_name):
            # The CSV carries a placeholder in verbatim_text_embedding (the
            # real pipeline populates it via CDC -> Lambda -> Titan); the
            # seed embeds the normalized verbatim_text here instead.
            embedding = embed(bedrock, row["verbatim_text"])
            execute(
                """
                INSERT INTO dictionary_terms
                  (record_id, dictionary, dictionary_version, dict_term,
                   dict_term_type, dict_term_code, dict_term_id, derivation,
                   hierarchy, is_prior_index, verbatim_text,
                   verbatim_text_embedding, last_modified_ts, created_at_ts)
                VALUES
                  (:record_id, :dictionary, :dictionary_version, :dict_term,
                   :dict_term_type, :dict_term_code, :dict_term_id, :derivation,
                   :hierarchy::jsonb, :is_prior_index, :verbatim_text,
                   :embedding::vector, :last_modified_ts, :created_at_ts)
                """,
                [
                    string_param("record_id", row["record_id"]),
                    string_param("dictionary", row["dictionary"]),
                    string_param("dictionary_version", row["dictionary_version"]),
                    string_param("dict_term", row["dict_term"]),
                    string_param("dict_term_type", row["dict_term_type"]),
                    string_param("dict_term_code", row["dict_term_code"]),
                    string_param("dict_term_id", row["dict_term_id"]),
                    string_param("derivation", row["derivation"]),
                    string_param("hierarchy", row["hierarchy"]),
                    bool_param("is_prior_index", row["is_prior_index"]),
                    string_param("verbatim_text", row["verbatim_text"]),
                    string_param("embedding", vector_literal(embedding)),
                    long_param("last_modified_ts", row["last_modified_ts"]),
                    long_param("created_at_ts", row["created_at_ts"]),
                ],
            )
            dictionary_rows += 1
            print(f"  {row['dictionary']:8s} {row['dict_term_code']}  {row['dict_term']}")

    print("Inserting synonym list...")
    synonym_rows = 0
    for row in read_csv(SYNONYM_CSV):
        execute(
            """
            INSERT INTO synonym_list
              (record_id, dictionary, dictionary_version, verbatim, dict_term,
               dict_term_type, dict_term_code, dict_term_id, derivation,
               hierarchy, status, changed_by, last_modified_ts, created_at_ts)
            VALUES
              (:record_id, :dictionary, :dictionary_version, :verbatim, :dict_term,
               :dict_term_type, :dict_term_code, :dict_term_id, :derivation,
               :hierarchy::jsonb, :status, :changed_by, :last_modified_ts, :created_at_ts)
            """,
            [
                string_param("record_id", row["record_id"]),
                string_param("dictionary", row["dictionary"]),
                string_param("dictionary_version", row["dictionary_version"]),
                string_param("verbatim", row["verbatim"]),
                string_param("dict_term", row["dict_term"]),
                string_param("dict_term_type", row["dict_term_type"]),
                string_param("dict_term_code", row["dict_term_code"]),
                string_param("dict_term_id", row["dict_term_id"]),
                string_param("derivation", row["derivation"]),
                string_param("hierarchy", row["hierarchy"]),
                string_param("status", row["status"]),
                string_param("changed_by", row["changed_by"]),
                long_param("last_modified_ts", row["last_modified_ts"]),
                long_param("created_at_ts", row["created_at_ts"]),
            ],
        )
        synonym_rows += 1
        print(f"  '{row['verbatim']}' -> {row['dict_term']} ({row['status']})")

    print("Inserting terms-not-to-autocode block-list...")
    tna_rows = 0
    for row in read_csv(TNA_CSV):
        execute(
            """
            INSERT INTO terms_not_to_autocode
              (record_id, dictionary, verbatim, status, changed_by,
               last_modified_ts, created_at_ts)
            VALUES
              (:record_id, :dictionary, :verbatim, :status, :changed_by,
               :last_modified_ts, :created_at_ts)
            """,
            [
                string_param("record_id", row["record_id"]),
                string_param("dictionary", row["dictionary"]),
                string_param("verbatim", row["verbatim"]),
                string_param("status", row["status"]),
                string_param("changed_by", row["changed_by"]),
                long_param("last_modified_ts", row["last_modified_ts"]),
                long_param("created_at_ts", row["created_at_ts"]),
            ],
        )
        tna_rows += 1
        print(f"  '{row['verbatim']}'")

    print("Inserting study terms (input verbatims, status=open)...")
    study_rows = 0
    for row in read_csv(STUDY_TERMS_CSV):
        execute(
            """
            INSERT INTO study_terms
              (record_id, source_study, source_domain, verbatim,
               encoding_dictionary, encoding_dictionary_version, from_source,
               derivation_only, status, created_at_ts)
            VALUES
              (:record_id, :source_study, :source_domain, :verbatim,
               :encoding_dictionary, :encoding_dictionary_version, :from_source,
               :derivation_only, :status, :created_at_ts)
            """,
            [
                string_param("record_id", row["record_id"]),
                string_param("source_study", row["source_study"]),
                string_param("source_domain", row["source_domain"]),
                string_param("verbatim", row["verbatim"]),
                string_param("encoding_dictionary", row["encoding_dictionary"]),
                string_param("encoding_dictionary_version", row["encoding_dictionary_version"]),
                string_param("from_source", row["from_source"]),
                bool_param("derivation_only", row["derivation_only"]),
                string_param("status", row["status"]),
                long_param("created_at_ts", row["created_at_ts"]),
            ],
        )
        study_rows += 1
        print(f"  {row['source_domain']}  '{row['verbatim']}'  ({row['encoding_dictionary']})")

    print("Verifying...")
    counts = execute(
        """
        SELECT (SELECT count(*) FROM dictionary_terms)                                          AS dictionary_rows,
               (SELECT count(*) FROM dictionary_terms WHERE verbatim_text_embedding IS NOT NULL) AS embedded_rows,
               (SELECT count(*) FROM synonym_list)                                              AS synonyms,
               (SELECT count(*) FROM terms_not_to_autocode)                                     AS tna,
               (SELECT count(*) FROM study_terms WHERE status = 'open')                         AS open_study_terms
        """
    )["records"][0]
    db_dict, db_embedded, db_syn, db_tna, db_study = (f["longValue"] for f in counts)
    print(
        f"  dictionary rows: {db_dict} ({db_embedded} embedded), synonyms: {db_syn}, "
        f"terms-not-to-autocode: {db_tna}, open study terms: {db_study}"
    )
    expected = (dictionary_rows, dictionary_rows, synonym_rows, tna_rows, study_rows)
    if (db_dict, db_embedded, db_syn, db_tna, db_study) != expected:
        print(f"ERROR: database counts {counts} do not match CSV rows {expected}", file=sys.stderr)
        return 1
    print("Done.")
    return 0


def read_csv(name: str) -> list[dict]:
    path = os.path.join(DATA_DIR, name)
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def stack_outputs(session: boto3.Session, stack_name: str) -> dict:
    cfn = session.client("cloudformation")
    stacks = cfn.describe_stacks(StackName=stack_name)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in stacks[0].get("Outputs", [])}


def embed(bedrock, text: str) -> list:
    response = bedrock.invoke_model(
        modelId=EMBEDDING_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(
            {"inputText": text, "dimensions": EMBEDDING_DIMENSIONS, "normalize": True}
        ),
    )
    payload = json.loads(response["body"].read())
    embedding = payload.get("embedding")
    if not isinstance(embedding, list) or len(embedding) != EMBEDDING_DIMENSIONS:
        raise RuntimeError(f"Unexpected Titan embedding response shape: {payload.keys()}")
    return embedding


def vector_literal(embedding: list) -> str:
    """pgvector text representation; the Data API has no native vector type."""
    return "[" + ",".join(str(x) for x in embedding) + "]"


def string_param(name: str, value: str) -> dict:
    return {"name": name, "value": {"stringValue": value}}


def long_param(name: str, value: str) -> dict:
    return {"name": name, "value": {"longValue": int(value)}}


def bool_param(name: str, value: str) -> dict:
    return {"name": name, "value": {"booleanValue": value.strip().lower() in ("true", "1", "yes")}}


def execute_with_wakeup(rds_data, cluster_arn, secret_arn, database, sql, parameters) -> dict:
    """Execute a statement, retrying while a 0-ACU (auto-paused) cluster resumes."""
    attempts = 0
    while True:
        try:
            return rds_data.execute_statement(
                resourceArn=cluster_arn,
                secretArn=secret_arn,
                database=database,
                sql=sql,
                parameters=parameters or [],
            )
        except rds_data.exceptions.DatabaseResumingException:
            attempts += 1
            if attempts > 30:
                raise
            print("  (cluster resuming from auto-pause, waiting...)")
            time.sleep(5)


if __name__ == "__main__":
    sys.exit(main())
