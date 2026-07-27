#!/usr/bin/env python3
"""
Generate the vendor-neutral sample dataset for the autocoding blog post.

The study/site/subject identifiers and free-text verbatims are fabricated. The
dictionary terms and codes are a de minimis set of real MedDRA and WHODrug
entries (both proprietary/licensed dictionaries) reproduced illustratively to
show data shape and pipeline behavior; this is not a redistributable dictionary
extract, and no customer or patient data is included.

Run:  python generate_sample_data.py   (writes *.csv next to this file)
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))

# Neutral demo constants (replace any customer identifiers) -------------------
MEDDRA_VER = "v27.0"
WHODRUG_VER = "GLOBAL-2024"
STUDY_AE = "ONCO-2024-01"        # oncology study, adverse-event domain
STUDY_CM = "ONCO-2024-01"        # same study, con-med domain
CODER = "coding-sme"             # curated-list author
HUMAN_CODER = "medical-coder-01" # human reviewer
MACHINE = "autocoding-workflow"  # the Step Functions execution (machine coder)


def h(*levels):
    """Build a MedDRA hierarchy JSON array from (key,val) pairs already grouped."""
    return json.dumps(levels, separators=(",", ":"))


# ---------------------------------------------------------------------------
# MedDRA hierarchies (SOC -> HLGT -> HLT -> PT), grounded in the source samples
# ---------------------------------------------------------------------------
MEDDRA_HIER = {
    "10013156": [{  # LLT Dislocated shoulder -> PT Joint dislocation
        "ae_type": "C", "pt": "Joint dislocation", "pt_code": "10023204",
        "hlt": "Fractures and dislocations NEC", "hlt_code": "10027677",
        "hlgt": "Bone and joint injuries", "hlgt_code": "10005942",
        "soc": "Injury, poisoning and procedural complications", "soc_code": "10022117"}],
    "10021114": [{  # PT Hypothyroidism
        "ae_type": "C", "pt": "Hypothyroidism", "pt_code": "10021114",
        "hlt": "Thyroid hypofunction disorders", "hlt_code": "10043741",
        "hlgt": "Thyroid gland disorders", "hlgt_code": "10043739",
        "soc": "Endocrine disorders", "soc_code": "10014698"}],
    "10027599": [{  # PT Migraine
        "ae_type": "C", "pt": "Migraine", "pt_code": "10027599",
        "hlt": "Migraine headaches", "hlt_code": "10027603",
        "hlgt": "Headaches", "hlgt_code": "10019231",
        "soc": "Nervous system disorders", "soc_code": "10029205"}],
    "10052840": [{  # PT Cardiac flutter
        "ae_type": "C", "pt": "Cardiac flutter", "pt_code": "10052840",
        "hlt": "Rate and rhythm disorders NEC", "hlt_code": "10037908",
        "hlgt": "Cardiac arrhythmias", "hlgt_code": "10007521",
        "soc": "Cardiac disorders", "soc_code": "10007541"}],
    "10012594": [{  # LLT Diabetes -> PT Diabetes mellitus
        "ae_type": "C", "pt": "Diabetes mellitus", "pt_code": "10012601",
        "hlt": "Diabetes mellitus (incl subtypes)", "hlt_code": "10012602",
        "hlgt": "Glucose metabolism disorders (incl diabetes mellitus)", "hlgt_code": "10018424",
        "soc": "Metabolism and nutrition disorders", "soc_code": "10027433"}],
    "10037844": [{  # PT Rash
        "ae_type": "C", "pt": "Rash", "pt_code": "10037844",
        "hlt": "Rashes, eruptions and exanthems NEC", "hlt_code": "10052566",
        "hlgt": "Epidermal and dermal conditions", "hlgt_code": "10014982",
        "soc": "Skin and subcutaneous tissue disorders", "soc_code": "10040785"}],
    "10047700": [{  # PT Vomiting
        "ae_type": "C", "pt": "Vomiting", "pt_code": "10047700",
        "hlt": "Nausea and vomiting symptoms", "hlt_code": "10028817",
        "hlgt": "Gastrointestinal signs and symptoms", "hlgt_code": "10018012",
        "soc": "Gastrointestinal disorders", "soc_code": "10017947"}],
}

# Dictionary rows: (dict_term, type, code, id, derivation, hierarchy_code)
MEDDRA_DICT = [
    ("Dislocated shoulder", "LLT", "10013156", "731986", "Dislocated shoulder", "10013156"),
    ("Hypothyroidism", "PT", "10021114", "927267", "Hypothyroidism", "10021114"),
    ("Migraine", "PT", "10027599", "1108978", "Migraine", "10027599"),
    ("Cardiac flutter", "PT", "10052840", "706760", "Cardiac flutter", "10052840"),
    ("Diabetes mellitus", "PT", "10012601", "719750", "Diabetes mellitus", "10012594"),
    ("Rash", "PT", "10037844", "1109338", "Rash", "10037844"),
    ("Vomiting", "PT", "10047700", "700508", "Vomiting", "10047700"),
]

# ---------------------------------------------------------------------------
# WHODrug hierarchies (ATC1 -> ATC4 + generic name)
# ---------------------------------------------------------------------------
def atc(a1c, a1, a2c, a2, a3c, a3, a4c, a4, gen, gid):
    return [{"atc1_code": a1c, "atc1_term": a1, "atc2_code": a2c, "atc2_term": a2,
             "atc3_code": a3c, "atc3_term": a3, "atc4_code": a4c, "atc4_term": a4,
             "generic_name": gen, "generic_name_id": gid}]

WHODRUG_HIER = {
    "01503001001": atc("L", "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS",
                        "L02", "ENDOCRINE THERAPY",
                        "L02B", "HORMONE ANTAGONISTS AND RELATED AGENTS",
                        "L02BA", "ANTI-ESTROGENS", "FULVESTRANT", "01503001001"),
    "00109201001": atc("M", "MUSCULO-SKELETAL SYSTEM",
                        "M01", "ANTIINFLAMMATORY AND ANTIRHEUMATIC PRODUCTS",
                        "M01A", "ANTIINFLAMMATORY AND ANTIRHEUMATIC PRODUCTS, NON-STEROIDS",
                        "M01AE", "PROPIONIC ACID DERIVATIVES", "IBUPROFEN", "00109201001"),
    "00082701001": atc("A", "ALIMENTARY TRACT AND METABOLISM",
                        "A10", "DRUGS USED IN DIABETES",
                        "A10B", "BLOOD GLUCOSE LOWERING DRUGS, EXCL. INSULINS",
                        "A10BA", "BIGUANIDES", "METFORMIN", "00082701001"),
    "00101801382": atc("R", "RESPIRATORY SYSTEM",
                        "R02", "THROAT PREPARATIONS",
                        "R02A", "THROAT PREPARATIONS",
                        "R02AX", "OTHER THROAT PREPARATIONS", "TRANEXAMIC ACID", "00101801001"),
}

# (dict_term, type, code, id, derivation, hier_code)
WHODRUG_DICT = [
    ("FULVESTRANT", "generic name", "01503001001", "3111087", "FULVESTRANT", "01503001001"),
    ("IBUPROFEN", "generic name", "00109201001", "3103345", "IBUPROFEN", "00109201001"),
    ("METFORMIN", "generic name", "00082701001", "3103365", "METFORMIN", "00082701001"),
    ("NEXIM", "trade name", "00101801382", "3941840", "TRANEXAMIC ACID", "00101801382"),
]


def norm(text):
    """Normalized verbatim_text: lowercased, punctuation -> space, collapse."""
    out = []
    for ch in text.lower():
        out.append(ch if ch.isalnum() else " ")
    return " ".join("".join(out).split())


DICT_HEADER = ["record_id", "dictionary", "dictionary_version", "dict_term",
               "dict_term_type", "dict_term_code", "dict_term_id", "derivation",
               "hierarchy", "is_prior_index", "verbatim_text",
               "verbatim_text_embedding", "last_modified_ts", "created_at_ts"]


def write_dict(fname, dictionary, version, rows, hiermap):
    with open(os.path.join(HERE, fname), "w", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(DICT_HEADER)
        for term, typ, code, tid, deriv, hcode in rows:
            w.writerow([code, dictionary, version, term, typ, code, tid, deriv,
                        json.dumps(hiermap[hcode], separators=(",", ":")),
                        "false", norm(term),
                        "<1024-dim vector, populated by CDC->Lambda->Titan>",
                        "1727800322", "1727800322"])


write_dict("dictionary_terms_meddra.csv", "MedDRA", MEDDRA_VER, MEDDRA_DICT, MEDDRA_HIER)
write_dict("dictionary_terms_whodrug.csv", "WHODrug", WHODRUG_VER, WHODRUG_DICT, WHODRUG_HIER)


# ---------------------------------------------------------------------------
# Synonym list (curated verbatim -> real code). changed_by scrubbed to CODER.
# ---------------------------------------------------------------------------
SYN_HEADER = ["record_id", "dictionary", "dictionary_version", "verbatim",
              "dict_term", "dict_term_type", "dict_term_code", "dict_term_id",
              "derivation", "hierarchy", "status", "changed_by",
              "last_modified_ts", "created_at_ts"]

# (verbatim, dict_term, code, id, hier_code, status)
SYNONYMS = [
    ("Hypothyroid", "Hypothyroidism", "10021114", "927267", "10021114", "active"),
    ("frequent migraines", "Migraine", "10027599", "1108978", "10027599", "active"),
    ("diabetes", "Diabetes mellitus", "10012601", "719750", "10012594", "active"),
    ("occasional heart flutters", "Cardiac flutter", "10052840", "706760", "10052840", "active"),
    ("emmmesis", "Vomiting", "10047700", "700508", "10047700", "pending_review"),
]

with open(os.path.join(HERE, "synonym_list.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(SYN_HEADER)
    for i, (vb, term, code, tid, hc, status) in enumerate(SYNONYMS, 1):
        w.writerow([f"meddra_{MEDDRA_VER}-SYN-{i:04d}", "MedDRA", MEDDRA_VER, vb,
                    term, "PT", code, tid, term,
                    json.dumps(MEDDRA_HIER[hc], separators=(",", ":")),
                    status, CODER, "1723475758", "1723475758"])


# ---------------------------------------------------------------------------
# Terms not to autocode (block-list)
# ---------------------------------------------------------------------------
TNA = ["BLEEDING", "DISCOMFORT", "ECHO", "HAEMORRHAGE", "HYPERTONIA",
       "HYPOTONIA", "INFARCTION", "INFECTION", "REGURGITATION"]
with open(os.path.join(HERE, "terms_not_to_autocode.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["record_id", "dictionary", "verbatim", "status", "changed_by",
                "last_modified_ts", "created_at_ts"])
    for i, t in enumerate(TNA, 1):
        w.writerow([f"meddra_tna-{i:04d}", "MedDRA", t, "active", CODER,
                    "1723475758", "1723475758"])


# ---------------------------------------------------------------------------
# Study terms — the INPUT verbatims to encode (status=open)
# ---------------------------------------------------------------------------
STUDY_HEADER = ["record_id", "source_study", "source_domain", "verbatim",
                "encoding_dictionary", "encoding_dictionary_version",
                "from_source", "derivation_only", "status", "created_at_ts"]

# (domain, verbatim, dict, version, from_source, derivation_only)
STUDY_INPUT = [
    ("AE", "Dislocated shoulder", "MedDRA", MEDDRA_VER, "EDC", "False"),
    ("AE", "Hypothyroid", "MedDRA", MEDDRA_VER, "EDC", "False"),
    ("AE", "HAEMORRHAGE", "MedDRA", MEDDRA_VER, "EDC", "False"),
    ("AE", "migrane", "MedDRA", MEDDRA_VER, "EDC", "False"),
    ("AE", "flutters in my chest sometimes", "MedDRA", MEDDRA_VER, "EDC", "False"),
    ("AE", "asdfghjkl", "MedDRA", MEDDRA_VER, "EDC", "False"),
    ("CM", "ibuprofen", "WHODrug", WHODRUG_VER, "EDC", "False"),
    ("CM", "FULVESTRANT", "WHODrug", WHODRUG_VER, "EDC", "True"),
    ("CM", "nexiuum", "WHODrug", WHODRUG_VER, "EDC", "False"),
]

with open(os.path.join(HERE, "study_terms_input.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(STUDY_HEADER)
    for i, (dom, vb, d, ver, src, do) in enumerate(STUDY_INPUT, 1):
        site = f"{1000+i}"
        rid = f"{STUDY_AE};{src};{site};{site}0{i:02d};eg_SCREENING;ev_SCREENING;1;{dom};{20+i};1"
        w.writerow([rid, STUDY_AE, dom, vb, d, ver, src, do, "open", "1779681573"])


# ---------------------------------------------------------------------------
# Study metadata — what the trial is about, in prose. Read by the
# get_study_info tool so the agent can break ties between candidate terms
# that similarity search alone cannot separate. Deliberately minimal:
# surrogate id, the study name study_terms.source_study points at, and a
# free-text description.
# ---------------------------------------------------------------------------
STUDY_METADATA = [
    (1, STUDY_AE,
     "Phase 3 randomized open-label study of fulvestrant plus a CDK4/6 inhibitor "
     "in postmenopausal women with hormone-receptor-positive, HER2-negative "
     "advanced or metastatic breast cancer who progressed on prior endocrine "
     "therapy. Adverse events of special interest include neutropenia, "
     "hepatotoxicity, QT prolongation and other cardiac rhythm disturbances, "
     "injection-site reactions, hot flushes, musculoskeletal pain, and fatigue. "
     "Concomitant medications are commonly analgesics, antiemetics, "
     "bisphosphonates, and endocrine agents. Cardiac and hepatic events are "
     "actively monitored; endocrine and metabolic events are expected given the "
     "mechanism of action."),
]

with open(os.path.join(HERE, "study_metadata.csv"), "w", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
    w.writerow(["id", "study_name", "study_description"])
    for sid, name, desc in STUDY_METADATA:
        w.writerow([sid, name, desc])


# ---------------------------------------------------------------------------
# Encoded output examples (the OUTPUT shape) — real coded-data shape,
# identifiers scrubbed. Shows the full CodingStatus lifecycle.
# ---------------------------------------------------------------------------
AE_HEADER = ["AETERM", "CodingStatus", "DictionaryRelease", "LLT", "PT", "PTCD",
             "HLT", "HLGT", "SOC", "PrimaryPath", "LastCodedBy", "MatchScore"]
AE_ROWS = [
    ("Dislocated shoulder", "Autocoded", "MedDRA v27.0", "Dislocated shoulder",
     "Joint dislocation", "10023204", "Fractures and dislocations NEC",
     "Bone and joint injuries", "Injury, poisoning and procedural complications",
     "Y", MACHINE, "1.00"),
    ("Hypothyroid", "Autocoded", "MedDRA v27.0", "Hypothyroidism", "Hypothyroidism",
     "10021114", "Thyroid hypofunction disorders", "Thyroid gland disorders",
     "Endocrine disorders", "Y", MACHINE, "1.00"),
    ("migrane", "Autocoded", "MedDRA v27.0", "Migraine", "Migraine", "10027599",
     "Migraine headaches", "Headaches", "Nervous system disorders", "Y", MACHINE, "0.94"),
    ("flutters in my chest sometimes", "Pending Approval", "MedDRA v27.0",
     "Cardiac flutter", "Cardiac flutter", "10052840", "Rate and rhythm disorders NEC",
     "Cardiac arrhythmias", "Cardiac disorders", "Y", MACHINE, "0.78"),
    ("HAEMORRHAGE", "Open", "MedDRA v27.0", "", "", "", "", "", "", "", "", ""),
    ("asdfghjkl", "Open", "MedDRA v27.0", "", "", "", "", "", "", "", "", ""),
]
with open(os.path.join(HERE, "encoded_ae_meddra.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(AE_HEADER)
    w.writerows(AE_ROWS)

CM_HEADER = ["CMTRT", "CodingStatus", "DictionaryRelease", "PreferredName",
             "PreferredCD", "DICT_TERM", "DICT_TERMCODE", "DERIVATION",
             "STATUS", "STATUS_CHANGED_BY", "MatchScore"]
CM_ROWS = [
    ("ibuprofen", "Coded", "GLOBAL-2024", "IBUPROFEN", "00109201001",
     "IBUPROFEN", "00109201001", "IBUPROFEN", "autocoded", MACHINE, "1.00"),
    ("FULVESTRANT", "Coded", "GLOBAL-2024", "FULVESTRANT", "01503001001",
     "", "", "FULVESTRANT", "autocoded (derivation_only)", MACHINE, "1.00"),
    ("nexiuum", "Coded", "GLOBAL-2024", "TRANEXAMIC ACID", "00101801001",
     "NEXIM", "00101801382", "TRANEXAMIC ACID", "approved", HUMAN_CODER, "0.71"),
]
with open(os.path.join(HERE, "encoded_cm_whodrug.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(CM_HEADER)
    w.writerows(CM_ROWS)


# ---------------------------------------------------------------------------
# Golden walkthrough — one trace per case, stage by stage (the "unit tests")
# ---------------------------------------------------------------------------
GOLD_HEADER = ["case_id", "case_name", "stage", "table", "verbatim", "dict_term",
               "dict_term_type", "dict_term_code", "derivation", "status",
               "match_score", "notes"]
GOLD = [
    # CASE A: exact match -> autocoded (deterministic)
    ("A", "exact_match_autocoded", "input", "study_terms", "Dislocated shoulder",
     "", "", "", "", "open", "", "AE verbatim ingested from EDC awaiting coding"),
    ("A", "exact_match_autocoded", "tna_guard", "terms_not_to_autocode",
     "Dislocated shoulder", "", "", "", "", "", "", "no block-list hit -> continue"),
    ("A", "exact_match_autocoded", "exact_match", "dictionary_terms",
     "Dislocated shoulder", "Dislocated shoulder", "LLT", "10013156",
     "Dislocated shoulder", "", "1.00",
     "unique LLT exact match; carries promotion to PT Joint dislocation (10023204)"),
    ("A", "exact_match_autocoded", "output", "study_terms", "Dislocated shoulder",
     "Dislocated shoulder", "LLT", "10013156", "Dislocated shoulder", "autocoded",
     "1.00", "status_changed_by=autocoding-workflow (machine coded, no human)"),

    # CASE B: synonym match -> autocoded
    ("B", "synonym_match_autocoded", "input", "study_terms", "Hypothyroid",
     "", "", "", "", "open", "", "'Hypothyroid' is not a valid MedDRA term on its own"),
    ("B", "synonym_match_autocoded", "tna_guard", "terms_not_to_autocode",
     "Hypothyroid", "", "", "", "", "", "", "no block-list hit -> continue"),
    ("B", "synonym_match_autocoded", "synonym", "synonym_list", "Hypothyroid",
     "Hypothyroidism", "PT", "10021114", "Hypothyroidism", "active", "1.00",
     "curated synonym pins verbatim to real PT code 10021114"),
    ("B", "synonym_match_autocoded", "output", "study_terms", "Hypothyroid",
     "Hypothyroidism", "PT", "10021114", "Hypothyroidism", "autocoded", "1.00",
     "synonym-driven exact match; machine coded"),

    # CASE C: TNA block -> open
    ("C", "tna_block_open", "input", "study_terms", "HAEMORRHAGE",
     "", "", "", "", "open", "", "verbatim ingested awaiting coding"),
    ("C", "tna_block_open", "tna_guard", "terms_not_to_autocode", "HAEMORRHAGE",
     "", "", "", "", "active", "", "BLOCK-list hit -> autocoder returns nothing"),
    ("C", "tna_block_open", "output", "study_terms", "HAEMORRHAGE",
     "", "", "", "", "open", "", "stays open for a human coder (safety block, not 'no match')"),

    # CASE D: agent semantic search -> autocoded (high confidence)
    ("D", "agent_semantic_autocoded", "input", "study_terms", "migrane",
     "", "", "", "", "open", "", "typo of 'migraine'; no exact/synonym hit"),
    ("D", "agent_semantic_autocoded", "tna_guard", "terms_not_to_autocode", "migrane",
     "", "", "", "", "", "", "no block-list hit -> continue"),
    ("D", "agent_semantic_autocoded", "agent_search", "dictionary_terms", "migrane",
     "Migraine", "PT", "10027599", "Migraine", "", "0.94",
     "AgentCore semantic search over pgvector; score >= autocode threshold (0.90)"),
    ("D", "agent_semantic_autocoded", "output", "study_terms", "migrane",
     "Migraine", "PT", "10027599", "Migraine", "autocoded", "0.94",
     "machine coded via agent path"),

    # CASE E: agent semantic search -> approval_required (medium confidence)
    ("E", "agent_semantic_review", "input", "study_terms",
     "flutters in my chest sometimes", "", "", "", "", "open", "",
     "verbose lay description; no exact/synonym hit"),
    ("E", "agent_semantic_review", "agent_search", "dictionary_terms",
     "flutters in my chest sometimes", "Cardiac flutter", "PT", "10052840",
     "Cardiac flutter", "", "0.78",
     "score between review (0.70) and autocode (0.90) thresholds"),
    ("E", "agent_semantic_review", "output", "study_terms",
     "flutters in my chest sometimes", "Cardiac flutter", "PT", "10052840",
     "Cardiac flutter", "approval_required", "0.78",
     "routed to a human coder for one-click confirm/override"),

    # CASE F: no confident match -> open
    ("F", "no_confident_match_open", "input", "study_terms", "asdfghjkl",
     "", "", "", "", "open", "", "garbage verbatim"),
    ("F", "no_confident_match_open", "agent_search", "dictionary_terms", "asdfghjkl",
     "", "", "", "", "", "0.05", "top candidate below review threshold (0.70)"),
    ("F", "no_confident_match_open", "output", "study_terms", "asdfghjkl",
     "", "", "", "", "open", "", "left open for manual coding (score not persisted on the open path)"),

    # CASE G: WHODrug exact -> autocoded
    ("G", "whodrug_exact_autocoded", "input", "study_terms", "ibuprofen",
     "", "", "", "", "open", "", "con-med verbatim, WHODrug"),
    ("G", "whodrug_exact_autocoded", "exact_match", "dictionary_terms", "ibuprofen",
     "IBUPROFEN", "generic name", "00109201001", "IBUPROFEN", "", "1.00",
     "unique generic-name exact match; ATC M01AE PROPIONIC ACID DERIVATIVES"),
    ("G", "whodrug_exact_autocoded", "output", "study_terms", "ibuprofen",
     "IBUPROFEN", "generic name", "00109201001", "IBUPROFEN", "autocoded", "1.00",
     "machine coded"),

    # CASE H: derivation_only -> derivation + hierarchy only
    ("H", "derivation_only", "input", "study_terms", "FULVESTRANT",
     "", "", "", "", "open", "",
     "derivation_only=True (from_source=EDC + dict=WHODrug)"),
    ("H", "derivation_only", "exact_match", "dictionary_terms", "FULVESTRANT",
     "FULVESTRANT", "generic name", "01503001001", "FULVESTRANT", "", "1.00",
     "exact 1:1 match required; ATC L02BA ANTI-ESTROGENS"),
    ("H", "derivation_only", "output", "study_terms", "FULVESTRANT",
     "", "", "", "FULVESTRANT", "autocoded", "1.00",
     "updates ONLY derivation + ATC hierarchy, never a new dict_term"),

    # CASE I: agent review-tier candidate -> human confirms & approves
    ("I", "human_review_approved", "input", "study_terms", "nexiuum",
     "", "", "", "", "open", "", "misspelling; WHODrug con-med"),
    ("I", "human_review_approved", "agent_search", "dictionary_terms", "nexiuum",
     "NEXIM", "trade name", "00101801382", "TRANEXAMIC ACID", "", "0.71",
     "agent proposes NEXIM at review-tier confidence (0.70-0.90) -> approval_required"),
    ("I", "human_review_approved", "output", "study_terms", "nexiuum",
     "NEXIM", "trade name", "00101801382", "TRANEXAMIC ACID", "approved", "0.71",
     "status_changed_by=medical-coder-01 (human) confirms the proposed code; "
     "final derivation TRANEXAMIC ACID is NEXIM's generic ingredient"),
]
with open(os.path.join(HERE, "golden_walkthrough.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(GOLD_HEADER)
    w.writerows(GOLD)

print("Wrote:")
for fn in sorted(os.listdir(HERE)):
    if fn.endswith(".csv"):
        with open(os.path.join(HERE, fn)) as f:
            n = sum(1 for _ in f) - 1
        print(f"  {fn:38s} {n:3d} data rows")
