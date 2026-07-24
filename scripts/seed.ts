#!/usr/bin/env -S npx tsx
/**
 * Seed the coding demo's Aurora pgvector database from the sample CSVs.
 *
 * Creates the four-table autocoding schema (pgvector extension +
 * dictionary_terms / synonym_list / terms_not_to_autocode / study_terms),
 * loads the fixture CSVs from data/, generates Titan Text Embeddings v2
 * vectors for each dictionary row, and stores them back - all through the
 * RDS Data API, so it runs from any machine with AWS credentials and no VPC
 * or database connectivity.
 *
 * This is a stand-in for the eventual CDC -> Lambda -> embedding pipeline
 * (deferred): for now embeddings are written by this local script.
 * Re-running is safe - the script drops and recreates the tables.
 *
 * Data provenance: the study/site/subject identifiers and free-text
 * verbatims in the CSVs are fabricated. The dictionary entries are a
 * de minimis illustrative set showing the shape of MedDRA and WHODrug
 * records (both proprietary, licensed dictionaries) - this is NOT a
 * redistributable dictionary extract and includes no customer or patient
 * data. See data/generate_sample_data.py.
 *
 * Usage:
 *   npx tsx scripts/seed.ts [--region REGION] [--stack MedicalCodingAgentCoreDemo]
 *   npm run seed -- --region us-east-1
 *
 * Requires: AWS credentials with cloudformation:DescribeStacks,
 * rds-data:ExecuteStatement, secretsmanager:GetSecretValue (via the Data
 * API), and bedrock:InvokeModel on amazon.titan-embed-text-v2:0.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  RDSDataClient,
  ExecuteStatementCommand,
  DatabaseResumingException,
  SqlParameter,
  Field,
} from '@aws-sdk/client-rds-data';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const EMBEDDING_DIMENSIONS = 1024;

// Compiled as CommonJS (tsconfig.json has module: NodeNext, no "type":
// "module" in package.json), so the __dirname global is available natively.
const DATA_DIR = join(__dirname, '..', 'data');

const DICTIONARY_CSVS = ['dictionary_terms_meddra.csv', 'dictionary_terms_whodrug.csv'];
const SYNONYM_CSV = 'synonym_list.csv';
const TNA_CSV = 'terms_not_to_autocode.csv';
const STUDY_TERMS_CSV = 'study_terms_input.csv';

// One Aurora instance stores BOTH the relational reference data AND its
// embedding vectors (an extra vector column on dictionary_terms), so the
// agent's semantic search runs against the same database the study data
// lives in.
const SCHEMA_STATEMENTS = [
  'CREATE EXTENSION IF NOT EXISTS vector',
  'DROP TABLE IF EXISTS study_terms',
  'DROP TABLE IF EXISTS synonym_list',
  'DROP TABLE IF EXISTS terms_not_to_autocode',
  'DROP TABLE IF EXISTS dictionary_terms',
  // 1) Dictionary terms (the controlled vocabulary we code AGAINST).
  //    hierarchy JSONB captures the dictionary path (MedDRA
  //    SOC->HLGT->HLT->PT, or WHODrug ATC1->ATC4).
  `
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
      verbatim_text_embedding VECTOR(${EMBEDDING_DIMENSIONS}),
      last_modified_ts     BIGINT,
      created_at_ts        BIGINT
  )
  `,
  'CREATE INDEX ON dictionary_terms (dictionary, dictionary_version)',
  'CREATE INDEX ON dictionary_terms (lower(verbatim_text))',
  // Approximate-nearest-neighbor index for cosine distance (<=>)
  `
  CREATE INDEX dictionary_terms_embedding_hnsw
      ON dictionary_terms USING hnsw (verbatim_text_embedding vector_cosine_ops)
  `,
  // 2) Synonym list (curated verbatim -> real dictionary encoding). Widens
  //    "exact match": a human-curated row lets a non-obvious verbatim
  //    (e.g. 'Hypothyroid') exact-match a real code.
  `
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
  `,
  'CREATE INDEX ON synonym_list (dictionary, dictionary_version, lower(verbatim))',
  // 3) Terms not to autocode (a BLOCK-list, checked FIRST). An exact
  //    verbatim hit here means: never auto-assign - leave for a human coder.
  `
  CREATE TABLE terms_not_to_autocode (
      record_id            TEXT PRIMARY KEY,
      dictionary           TEXT NOT NULL,
      verbatim             TEXT NOT NULL,
      status               TEXT DEFAULT 'active',
      changed_by           TEXT,
      last_modified_ts     BIGINT,
      created_at_ts        BIGINT
  )
  `,
  'CREATE INDEX ON terms_not_to_autocode (dictionary, lower(verbatim))',
  // 4) Study terms (the INPUT verbatims to encode, and the OUTPUT after
  //    coding - the same row is updated in place; status tracks lifecycle).
  `
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
  `,
  "CREATE INDEX ON study_terms (status)",
  'CREATE INDEX ON study_terms (source_study, source_domain)',
];

interface CsvRow {
  [column: string]: string;
}

interface Args {
  region?: string;
  stack: string;
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = { stack: 'MedicalCodingAgentCoreDemo' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--region') args.region = argv[++i];
    else if (argv[i] === '--stack') args.stack = argv[++i];
  }
  return args;
};

const readCsv = (name: string): CsvRow[] => {
  const path = join(DATA_DIR, name);
  const content = readFileSync(path, 'utf-8');
  return parseCsv(content, { columns: true, skip_empty_lines: true }) as CsvRow[];
};

const stackOutputs = async (
  cfn: CloudFormationClient,
  stackName: string
): Promise<Record<string, string>> => {
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs: Record<string, string> = {};
  for (const o of Stacks?.[0]?.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
  }
  return outputs;
};

const embed = async (bedrock: BedrockRuntimeClient, text: string): Promise<number[]> => {
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
        dimensions: EMBEDDING_DIMENSIONS,
        normalize: true,
      }),
    })
  );
  const payload = JSON.parse(new TextDecoder().decode(response.body));
  if (!Array.isArray(payload.embedding) || payload.embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected Titan embedding response shape: ${Object.keys(payload)}`);
  }
  return payload.embedding;
};

/** pgvector text representation; the Data API has no native vector type. */
const vectorLiteral = (embedding: number[]): string => `[${embedding.join(',')}]`;

const stringParam = (name: string, value: string): SqlParameter => ({
  name,
  value: { stringValue: value },
});

const longParam = (name: string, value: string): SqlParameter => ({
  name,
  value: { longValue: parseInt(value, 10) },
});

const boolParam = (name: string, value: string): SqlParameter => ({
  name,
  value: { booleanValue: ['true', '1', 'yes'].includes(value.trim().toLowerCase()) },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Execute a statement, retrying while a 0-ACU (auto-paused) cluster resumes. */
const executeWithWakeup = async (
  rdsData: RDSDataClient,
  clusterArn: string,
  secretArn: string,
  database: string,
  sql: string,
  parameters: SqlParameter[] = []
) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rdsData.send(
        new ExecuteStatementCommand({
          resourceArn: clusterArn,
          secretArn,
          database,
          sql,
          parameters,
          includeResultMetadata: true,
        })
      );
    } catch (err) {
      if (!(err instanceof DatabaseResumingException) || attempt >= 30) {
        throw err;
      }
      console.log('  (cluster resuming from auto-pause, waiting...)');
      await sleep(5000);
    }
  }
};

const fieldToLong = (field: Field): number => {
  if (field.longValue === undefined) {
    throw new Error(`Expected a longValue field, got: ${JSON.stringify(field)}`);
  }
  return field.longValue;
};

const main = async (): Promise<number> => {
  const args = parseArgs(process.argv.slice(2));

  const cfn = new CloudFormationClient({ region: args.region });
  const outputs = await stackOutputs(cfn, args.stack);
  const clusterArn = outputs.DbClusterArn;
  const secretArn = outputs.DbSecretArn;
  const database = outputs.DbName;
  if (!clusterArn || !secretArn || !database) {
    console.error(
      `Stack "${args.stack}" is missing DbClusterArn/DbSecretArn/DbName outputs. Deploy first.`
    );
    return 1;
  }
  console.log(`Cluster: ${clusterArn}\nDatabase: ${database}`);

  const rdsData = new RDSDataClient({ region: args.region });
  const bedrock = new BedrockRuntimeClient({ region: args.region });

  const execute = (sql: string, parameters?: SqlParameter[]) =>
    executeWithWakeup(rdsData, clusterArn, secretArn, database, sql, parameters);

  console.log('Creating schema (drop + recreate)...');
  for (const statement of SCHEMA_STATEMENTS) {
    await execute(statement);
  }

  console.log('Inserting dictionary rows and generating embeddings...');
  let dictionaryRows = 0;
  for (const csvName of DICTIONARY_CSVS) {
    for (const row of readCsv(csvName)) {
      // The CSV carries a placeholder in verbatim_text_embedding (the real
      // pipeline populates it via CDC -> Lambda -> Titan); the seed embeds
      // the normalized verbatim_text here instead.
      const embedding = await embed(bedrock, row.verbatim_text);
      await execute(
        `
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
        `,
        [
          stringParam('record_id', row.record_id),
          stringParam('dictionary', row.dictionary),
          stringParam('dictionary_version', row.dictionary_version),
          stringParam('dict_term', row.dict_term),
          stringParam('dict_term_type', row.dict_term_type),
          stringParam('dict_term_code', row.dict_term_code),
          stringParam('dict_term_id', row.dict_term_id),
          stringParam('derivation', row.derivation),
          stringParam('hierarchy', row.hierarchy),
          boolParam('is_prior_index', row.is_prior_index),
          stringParam('verbatim_text', row.verbatim_text),
          stringParam('embedding', vectorLiteral(embedding)),
          longParam('last_modified_ts', row.last_modified_ts),
          longParam('created_at_ts', row.created_at_ts),
        ]
      );
      dictionaryRows += 1;
      console.log(`  ${row.dictionary.padEnd(8)} ${row.dict_term_code}  ${row.dict_term}`);
    }
  }

  console.log('Inserting synonym list...');
  let synonymRows = 0;
  for (const row of readCsv(SYNONYM_CSV)) {
    await execute(
      `
      INSERT INTO synonym_list
        (record_id, dictionary, dictionary_version, verbatim, dict_term,
         dict_term_type, dict_term_code, dict_term_id, derivation,
         hierarchy, status, changed_by, last_modified_ts, created_at_ts)
      VALUES
        (:record_id, :dictionary, :dictionary_version, :verbatim, :dict_term,
         :dict_term_type, :dict_term_code, :dict_term_id, :derivation,
         :hierarchy::jsonb, :status, :changed_by, :last_modified_ts, :created_at_ts)
      `,
      [
        stringParam('record_id', row.record_id),
        stringParam('dictionary', row.dictionary),
        stringParam('dictionary_version', row.dictionary_version),
        stringParam('verbatim', row.verbatim),
        stringParam('dict_term', row.dict_term),
        stringParam('dict_term_type', row.dict_term_type),
        stringParam('dict_term_code', row.dict_term_code),
        stringParam('dict_term_id', row.dict_term_id),
        stringParam('derivation', row.derivation),
        stringParam('hierarchy', row.hierarchy),
        stringParam('status', row.status),
        stringParam('changed_by', row.changed_by),
        longParam('last_modified_ts', row.last_modified_ts),
        longParam('created_at_ts', row.created_at_ts),
      ]
    );
    synonymRows += 1;
    console.log(`  '${row.verbatim}' -> ${row.dict_term} (${row.status})`);
  }

  console.log('Inserting terms-not-to-autocode block-list...');
  let tnaRows = 0;
  for (const row of readCsv(TNA_CSV)) {
    await execute(
      `
      INSERT INTO terms_not_to_autocode
        (record_id, dictionary, verbatim, status, changed_by,
         last_modified_ts, created_at_ts)
      VALUES
        (:record_id, :dictionary, :verbatim, :status, :changed_by,
         :last_modified_ts, :created_at_ts)
      `,
      [
        stringParam('record_id', row.record_id),
        stringParam('dictionary', row.dictionary),
        stringParam('verbatim', row.verbatim),
        stringParam('status', row.status),
        stringParam('changed_by', row.changed_by),
        longParam('last_modified_ts', row.last_modified_ts),
        longParam('created_at_ts', row.created_at_ts),
      ]
    );
    tnaRows += 1;
    console.log(`  '${row.verbatim}'`);
  }

  console.log('Inserting study terms (input verbatims, status=open)...');
  let studyRows = 0;
  for (const row of readCsv(STUDY_TERMS_CSV)) {
    await execute(
      `
      INSERT INTO study_terms
        (record_id, source_study, source_domain, verbatim,
         encoding_dictionary, encoding_dictionary_version, from_source,
         derivation_only, status, created_at_ts)
      VALUES
        (:record_id, :source_study, :source_domain, :verbatim,
         :encoding_dictionary, :encoding_dictionary_version, :from_source,
         :derivation_only, :status, :created_at_ts)
      `,
      [
        stringParam('record_id', row.record_id),
        stringParam('source_study', row.source_study),
        stringParam('source_domain', row.source_domain),
        stringParam('verbatim', row.verbatim),
        stringParam('encoding_dictionary', row.encoding_dictionary),
        stringParam('encoding_dictionary_version', row.encoding_dictionary_version),
        stringParam('from_source', row.from_source),
        boolParam('derivation_only', row.derivation_only),
        stringParam('status', row.status),
        longParam('created_at_ts', row.created_at_ts),
      ]
    );
    studyRows += 1;
    console.log(`  ${row.source_domain}  '${row.verbatim}'  (${row.encoding_dictionary})`);
  }

  console.log('Verifying...');
  const countsResult = await execute(`
    SELECT (SELECT count(*) FROM dictionary_terms)                                          AS dictionary_rows,
           (SELECT count(*) FROM dictionary_terms WHERE verbatim_text_embedding IS NOT NULL) AS embedded_rows,
           (SELECT count(*) FROM synonym_list)                                              AS synonyms,
           (SELECT count(*) FROM terms_not_to_autocode)                                     AS tna,
           (SELECT count(*) FROM study_terms WHERE status = 'open')                         AS open_study_terms
  `);
  const counts = countsResult.records?.[0] ?? [];
  const [dbDict, dbEmbedded, dbSyn, dbTna, dbStudy] = counts.map(fieldToLong);
  console.log(
    `  dictionary rows: ${dbDict} (${dbEmbedded} embedded), synonyms: ${dbSyn}, ` +
      `terms-not-to-autocode: ${dbTna}, open study terms: ${dbStudy}`
  );
  const expected = [dictionaryRows, dictionaryRows, synonymRows, tnaRows, studyRows];
  const actual = [dbDict, dbEmbedded, dbSyn, dbTna, dbStudy];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(
      `ERROR: database counts ${JSON.stringify(actual)} do not match CSV rows ${JSON.stringify(expected)}`
    );
    return 1;
  }
  console.log('Done.');
  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
