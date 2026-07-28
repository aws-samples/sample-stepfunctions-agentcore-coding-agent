#!/usr/bin/env python3
"""
Generate the vendor-neutral sample dataset for the autocoding blog post.

The study/site/subject identifiers and free-text verbatims are fabricated. The
dictionary terms and codes are a de minimis set of MedDRA and WHODrug entries
(both proprietary/licensed dictionaries) reproduced illustratively to show data
shape and pipeline behavior; this is not a redistributable dictionary extract,
and no customer or patient data is included.

The dataset is deliberately built so that the two-tool agentic path has
something real to do:

  * Multiple dictionary terms sit CLOSE to each other in embedding space
    (Rash vs Rash maculo-papular, Palpitations vs Cardiac flutter vs
    Tachycardia, Abdominal pain vs Abdominal pain upper, Hot flush vs
    Flushing, Muscle spasms vs Myalgia). Similarity search alone cannot
    separate these.
  * THREE studies with contrasting therapeutic areas, so the same verbatim
    codes to a DIFFERENT term depending on which study reported it. That is
    what get_study_info exists for, and it is the pattern cases J and K
    demonstrate.

Run:  python generate_sample_data.py   (writes *.csv next to this file)
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))

MEDDRA_VER = "v27.0"
WHODRUG_VER = "GLOBAL-2024"

# Three contrasting studies -------------------------------------------------
STUDY_ONCO = "ONCO-2024-01"   # breast cancer; cardiac + musculoskeletal AESIs
STUDY_CARD = "CARD-2025-02"   # arrhythmia; cardiac rhythm AESIs
STUDY_GI = "GI-2025-03"       # GERD; upper-GI AESIs

CODER = "coding-sme"
# Retained for reference: the value a human reviewer writes into
# study_terms.status_changed_by when confirming or overriding a proposed code.
# The workflow itself never writes it - approval_required rows are handed off to
# the separate review UI, which is out of scope for this sample.
HUMAN_CODER = "medical-coder-01"  # noqa: F841
MACHINE = "autocoding-workflow"


# ---------------------------------------------------------------------------
# MedDRA hierarchies (SOC -> HLGT -> HLT -> PT)
# ---------------------------------------------------------------------------
def m(pt, pt_code, hlt, hlt_code, hlgt, hlgt_code, soc, soc_code):
    return [{"ae_type": "C", "pt": pt, "pt_code": pt_code,
             "hlt": hlt, "hlt_code": hlt_code,
             "hlgt": hlgt, "hlgt_code": hlgt_code,
             "soc": soc, "soc_code": soc_code}]


CARDIAC = ("Cardiac arrhythmias", "10007521", "Cardiac disorders", "10007541")
NERVOUS = ("Headaches", "10019231", "Nervous system disorders", "10029205")
GI_SYMPTOM = ("Gastrointestinal signs and symptoms", "10018012",
              "Gastrointestinal disorders", "10017947")
MSK = ("Musculoskeletal and connective tissue disorders NEC", "10028393",
       "Musculoskeletal and connective tissue disorders", "10028395")
SKIN = ("Epidermal and dermal conditions", "10014982",
        "Skin and subcutaneous tissue disorders", "10040785")
VASCULAR = ("Vascular hypertensive disorders", "10047071",
            "Vascular disorders", "10047065")

MEDDRA_HIER = {
    # --- Cardiac: four deliberately close rhythm terms ---
    "10052840": m("Cardiac flutter", "10052840", "Rate and rhythm disorders NEC",
                  "10037908", *CARDIAC),
    "10003658": m("Atrial fibrillation", "10003658", "Supraventricular arrhythmias",
                  "10042600", *CARDIAC),
    "10033557": m("Palpitations", "10033557", "Rate and rhythm disorders NEC",
                  "10037908", *CARDIAC),
    "10043071": m("Tachycardia", "10043071", "Rate and rhythm disorders NEC",
                  "10037908", *CARDIAC),
    "10014387": m("Electrocardiogram QT prolonged", "10014387",
                  "Electrocardiogram investigations", "10014363",
                  "Cardiac and vascular investigations (excl enzyme tests)",
                  "10007527", "Investigations", "10022891"),
    # --- Nervous system ---
    "10027599": m("Migraine", "10027599", "Migraine headaches", "10027603", *NERVOUS),
    "10019211": m("Headache", "10019211", "Headaches NEC", "10019233", *NERVOUS),
    "10013573": m("Dizziness", "10013573", "Neurological signs and symptoms NEC",
                  "10029317", "Neurological disorders NEC", "10029305",
                  "Nervous system disorders", "10029205"),
    "10033775": m("Paraesthesia", "10033775", "Paraesthesias and dysaesthesias",
                  "10033779", "Neurological disorders NEC", "10029305",
                  "Nervous system disorders", "10029205"),
    # --- Endocrine ---
    "10021114": m("Hypothyroidism", "10021114", "Thyroid hypofunction disorders",
                  "10043741", "Thyroid gland disorders", "10043739",
                  "Endocrine disorders", "10014698"),
    "10020850": m("Hyperthyroidism", "10020850", "Thyroid hyperfunction disorders",
                  "10043740", "Thyroid gland disorders", "10043739",
                  "Endocrine disorders", "10014698"),
    # --- Metabolism ---
    "10012594": m("Diabetes mellitus", "10012601",
                  "Diabetes mellitus (incl subtypes)", "10012602",
                  "Glucose metabolism disorders (incl diabetes mellitus)", "10018424",
                  "Metabolism and nutrition disorders", "10027433"),
    "10061428": m("Decreased appetite", "10061428", "Appetite disorders", "10002869",
                  "Appetite and general nutritional disorders", "10003018",
                  "Metabolism and nutrition disorders", "10027433"),
    # --- Skin: two close rash terms ---
    "10037844": m("Rash", "10037844", "Rashes, eruptions and exanthems NEC",
                  "10052566", *SKIN),
    "10037868": m("Rash maculo-papular", "10037868",
                  "Rashes, eruptions and exanthems NEC", "10052566", *SKIN),
    "10037087": m("Pruritus", "10037087", "Pruritus NEC", "10037088", *SKIN),
    # --- GI: abdominal pain vs upper abdominal pain, reflux vs dyspepsia ---
    "10047700": m("Vomiting", "10047700", "Nausea and vomiting symptoms",
                  "10028817", *GI_SYMPTOM),
    "10028813": m("Nausea", "10028813", "Nausea and vomiting symptoms",
                  "10028817", *GI_SYMPTOM),
    "10012735": m("Diarrhoea", "10012735", "Diarrhoea (excl infective)",
                  "10012736", *GI_SYMPTOM),
    "10000081": m("Abdominal pain", "10000081", "Gastrointestinal and abdominal pains",
                  "10017977", *GI_SYMPTOM),
    "10000087": m("Abdominal pain upper", "10000087",
                  "Gastrointestinal and abdominal pains", "10017977", *GI_SYMPTOM),
    "10017885": m("Gastrooesophageal reflux disease", "10017885",
                  "Gastrooesophageal reflux and associated disorders", "10017887",
                  "Gastrointestinal motility and defaecation conditions", "10018003",
                  "Gastrointestinal disorders", "10017947"),
    "10013946": m("Dyspepsia", "10013946", "Dyspeptic signs and symptoms",
                  "10013947", *GI_SYMPTOM),
    # --- Musculoskeletal: three close terms ---
    "10028334": m("Muscle spasms", "10028334", "Muscle related signs and symptoms",
                  "10028356", *MSK),
    "10028411": m("Myalgia", "10028411", "Muscle related signs and symptoms",
                  "10028356", *MSK),
    "10003239": m("Arthralgia", "10003239", "Joint related signs and symptoms",
                  "10023238", *MSK),
    # --- Injury ---
    "10013156": m("Joint dislocation", "10023204", "Fractures and dislocations NEC",
                  "10027677", "Bone and joint injuries", "10005942",
                  "Injury, poisoning and procedural complications", "10022117"),
    # --- Blood / investigations / general ---
    "10029354": m("Neutropenia", "10029354",
                  "Neutropenias", "10029366", "Neutrophil disorders", "10029364",
                  "Blood and lymphatic system disorders", "10005329"),
    "10001551": m("Alanine aminotransferase increased", "10001551",
                  "Liver function analyses", "10024690",
                  "Hepatobiliary investigations", "10019787",
                  "Investigations", "10022891"),
    "10016256": m("Fatigue", "10016256", "Asthenic conditions", "10003550",
                  "General system disorders NEC", "10018073",
                  "General disorders and administration site conditions", "10018065"),
    # --- Vascular: hot flush vs flushing (a real coder tie) ---
    "10060801": m("Hot flush", "10060801", "Flushing", "10016826", *VASCULAR),
    "10016825": m("Flushing", "10016825", "Flushing", "10016826", *VASCULAR),
}

# (dict_term, type, code, id, derivation, hierarchy_key)
MEDDRA_DICT = [
    ("Dislocated shoulder", "LLT", "10013156", "731986", "Dislocated shoulder", "10013156"),
    ("Hypothyroidism", "PT", "10021114", "927267", "Hypothyroidism", "10021114"),
    ("Hyperthyroidism", "PT", "10020850", "927266", "Hyperthyroidism", "10020850"),
    ("Migraine", "PT", "10027599", "1108978", "Migraine", "10027599"),
    ("Headache", "PT", "10019211", "1108977", "Headache", "10019211"),
    ("Dizziness", "PT", "10013573", "719751", "Dizziness", "10013573"),
    ("Paraesthesia", "PT", "10033775", "1108980", "Paraesthesia", "10033775"),
    ("Cardiac flutter", "PT", "10052840", "706760", "Cardiac flutter", "10052840"),
    ("Atrial fibrillation", "PT", "10003658", "706761", "Atrial fibrillation", "10003658"),
    ("Palpitations", "PT", "10033557", "706762", "Palpitations", "10033557"),
    ("Tachycardia", "PT", "10043071", "706763", "Tachycardia", "10043071"),
    ("Electrocardiogram QT prolonged", "PT", "10014387", "706764",
     "Electrocardiogram QT prolonged", "10014387"),
    ("Diabetes mellitus", "PT", "10012601", "719750", "Diabetes mellitus", "10012594"),
    ("Decreased appetite", "PT", "10061428", "719752", "Decreased appetite", "10061428"),
    ("Rash", "PT", "10037844", "1109338", "Rash", "10037844"),
    ("Rash maculo-papular", "PT", "10037868", "1109339", "Rash maculo-papular", "10037868"),
    ("Pruritus", "PT", "10037087", "1109340", "Pruritus", "10037087"),
    ("Vomiting", "PT", "10047700", "700508", "Vomiting", "10047700"),
    ("Nausea", "PT", "10028813", "700509", "Nausea", "10028813"),
    ("Diarrhoea", "PT", "10012735", "700510", "Diarrhoea", "10012735"),
    ("Abdominal pain", "PT", "10000081", "700511", "Abdominal pain", "10000081"),
    ("Abdominal pain upper", "PT", "10000087", "700512", "Abdominal pain upper", "10000087"),
    ("Gastrooesophageal reflux disease", "PT", "10017885", "700513",
     "Gastrooesophageal reflux disease", "10017885"),
    ("Dyspepsia", "PT", "10013946", "700514", "Dyspepsia", "10013946"),
    ("Muscle spasms", "PT", "10028334", "928001", "Muscle spasms", "10028334"),
    ("Myalgia", "PT", "10028411", "928002", "Myalgia", "10028411"),
    ("Arthralgia", "PT", "10003239", "928003", "Arthralgia", "10003239"),
    ("Neutropenia", "PT", "10029354", "929001", "Neutropenia", "10029354"),
    ("Alanine aminotransferase increased", "PT", "10001551", "929002",
     "Alanine aminotransferase increased", "10001551"),
    ("Fatigue", "PT", "10016256", "929003", "Fatigue", "10016256"),
    ("Hot flush", "PT", "10060801", "929004", "Hot flush", "10060801"),
    ("Flushing", "PT", "10016825", "929005", "Flushing", "10016825"),
]


# ---------------------------------------------------------------------------
# WHODrug hierarchies (ATC1 -> ATC4 + generic name)
# ---------------------------------------------------------------------------
def atc(a1c, a1, a2c, a2, a3c, a3, a4c, a4, gen, gid):
    return [{"atc1_code": a1c, "atc1_term": a1, "atc2_code": a2c, "atc2_term": a2,
             "atc3_code": a3c, "atc3_term": a3, "atc4_code": a4c, "atc4_term": a4,
             "generic_name": gen, "generic_name_id": gid}]


ALIMENTARY = ("A", "ALIMENTARY TRACT AND METABOLISM")
PPI = ("A02", "DRUGS FOR ACID RELATED DISORDERS",
       "A02B", "DRUGS FOR PEPTIC ULCER AND GASTRO-OESOPHAGEAL REFLUX DISEASE (GORD)",
       "A02BC", "PROTON PUMP INHIBITORS")

WHODRUG_HIER = {
    "01503001001": atc("L", "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS",
                       "L02", "ENDOCRINE THERAPY",
                       "L02B", "HORMONE ANTAGONISTS AND RELATED AGENTS",
                       "L02BA", "ANTI-ESTROGENS", "FULVESTRANT", "01503001001"),
    "01504001001": atc("L", "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS",
                       "L02", "ENDOCRINE THERAPY",
                       "L02B", "HORMONE ANTAGONISTS AND RELATED AGENTS",
                       "L02BG", "AROMATASE INHIBITORS", "LETROZOLE", "01504001001"),
    "00109201001": atc("M", "MUSCULO-SKELETAL SYSTEM",
                       "M01", "ANTIINFLAMMATORY AND ANTIRHEUMATIC PRODUCTS",
                       "M01A", "ANTIINFLAMMATORY AND ANTIRHEUMATIC PRODUCTS, NON-STEROIDS",
                       "M01AE", "PROPIONIC ACID DERIVATIVES", "IBUPROFEN", "00109201001"),
    "00082701001": atc(*ALIMENTARY, "A10", "DRUGS USED IN DIABETES",
                       "A10B", "BLOOD GLUCOSE LOWERING DRUGS, EXCL. INSULINS",
                       "A10BA", "BIGUANIDES", "METFORMIN", "00082701001"),
    # Esomeprazole / Nexium - a proton pump inhibitor (the CORRECT reading of
    # the "nexiuum" verbatim in case I).
    "00201501001": atc(*ALIMENTARY, *PPI, "ESOMEPRAZOLE", "00201501001"),
    "00201501382": atc(*ALIMENTARY, *PPI, "ESOMEPRAZOLE", "00201501001"),
    "00201601001": atc(*ALIMENTARY, *PPI, "OMEPRAZOLE", "00201601001"),
    # Tranexamic acid - an antifibrinolytic (B02AA02). "NEXIM" is retained as a
    # deliberate near-miss trade name: lexically very close to "nexiuum" but
    # clinically unrelated, so study context has to break the tie.
    "00101801001": atc("B", "BLOOD AND BLOOD FORMING ORGANS",
                       "B02", "ANTIHAEMORRHAGICS",
                       "B02A", "ANTIFIBRINOLYTICS",
                       "B02AA", "AMINO ACIDS", "TRANEXAMIC ACID", "00101801001"),
    "00101801382": atc("B", "BLOOD AND BLOOD FORMING ORGANS",
                       "B02", "ANTIHAEMORRHAGICS",
                       "B02A", "ANTIFIBRINOLYTICS",
                       "B02AA", "AMINO ACIDS", "TRANEXAMIC ACID", "00101801001"),
    "00304001001": atc("N", "NERVOUS SYSTEM", "N02", "ANALGESICS",
                       "N02B", "OTHER ANALGESICS AND ANTIPYRETICS",
                       "N02BE", "ANILIDES", "PARACETAMOL", "00304001001"),
    "00405001001": atc(*ALIMENTARY, "A04", "ANTIEMETICS AND ANTINAUSEANTS",
                       "A04A", "ANTIEMETICS AND ANTINAUSEANTS",
                       "A04AA", "SEROTONIN (5HT3) ANTAGONISTS",
                       "ONDANSETRON", "00405001001"),
    "00506001001": atc("M", "MUSCULO-SKELETAL SYSTEM",
                       "M05", "DRUGS FOR TREATMENT OF BONE DISEASES",
                       "M05B", "DRUGS AFFECTING BONE STRUCTURE AND MINERALIZATION",
                       "M05BA", "BISPHOSPHONATES", "ZOLEDRONIC ACID", "00506001001"),
}

WHODRUG_DICT = [
    ("FULVESTRANT", "generic name", "01503001001", "3111087", "FULVESTRANT", "01503001001"),
    ("LETROZOLE", "generic name", "01504001001", "3111088", "LETROZOLE", "01504001001"),
    ("IBUPROFEN", "generic name", "00109201001", "3103345", "IBUPROFEN", "00109201001"),
    ("METFORMIN", "generic name", "00082701001", "3103365", "METFORMIN", "00082701001"),
    ("ESOMEPRAZOLE", "generic name", "00201501001", "3941001", "ESOMEPRAZOLE", "00201501001"),
    ("NEXIUM", "trade name", "00201501382", "3941002", "ESOMEPRAZOLE", "00201501382"),
    ("OMEPRAZOLE", "generic name", "00201601001", "3941003", "OMEPRAZOLE", "00201601001"),
    ("TRANEXAMIC ACID", "generic name", "00101801001", "3941839", "TRANEXAMIC ACID", "00101801001"),
    ("NEXIM", "trade name", "00101801382", "3941840", "TRANEXAMIC ACID", "00101801382"),
    ("PARACETAMOL", "generic name", "00304001001", "3103400", "PARACETAMOL", "00304001001"),
    ("ONDANSETRON", "generic name", "00405001001", "3103401", "ONDANSETRON", "00405001001"),
    ("ZOLEDRONIC ACID", "generic name", "00506001001", "3103402", "ZOLEDRONIC ACID", "00506001001"),
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
        for term, typ, code, tid, deriv, hkey in rows:
            # record_id must be unique: trade and generic names can share a
            # dict_term_code family, so key on the row's own code + term.
            w.writerow([f"{code}-{norm(term).replace(' ', '_')}", dictionary, version,
                        term, typ, code, tid, deriv,
                        json.dumps(hiermap[hkey], separators=(",", ":")),
                        "false", norm(term),
                        "<1024-dim vector, populated by CDC->Lambda->Titan>",
                        "1727800322", "1727800322"])


write_dict("dictionary_terms_meddra.csv", "MedDRA", MEDDRA_VER, MEDDRA_DICT, MEDDRA_HIER)
write_dict("dictionary_terms_whodrug.csv", "WHODrug", WHODRUG_VER, WHODRUG_DICT, WHODRUG_HIER)


# ---------------------------------------------------------------------------
# Synonym list (curated verbatim -> real code)
# ---------------------------------------------------------------------------
SYN_HEADER = ["record_id", "dictionary", "dictionary_version", "verbatim",
              "dict_term", "dict_term_type", "dict_term_code", "dict_term_id",
              "derivation", "hierarchy", "status", "changed_by",
              "last_modified_ts", "created_at_ts"]

SYNONYMS = [
    ("Hypothyroid", "Hypothyroidism", "10021114", "927267", "10021114", "active"),
    ("frequent migraines", "Migraine", "10027599", "1108978", "10027599", "active"),
    ("diabetes", "Diabetes mellitus", "10012601", "719750", "10012594", "active"),
    ("occasional heart flutters", "Cardiac flutter", "10052840", "706760", "10052840", "active"),
    ("heartburn", "Gastrooesophageal reflux disease", "10017885", "700513", "10017885", "active"),
    ("tired all the time", "Fatigue", "10016256", "929003", "10016256", "active"),
    ("emmmesis", "Vomiting", "10047700", "700508", "10047700", "pending_review"),
]

with open(os.path.join(HERE, "synonym_list.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(SYN_HEADER)
    for i, (vb, term, code, tid, hk, status) in enumerate(SYNONYMS, 1):
        w.writerow([f"meddra_{MEDDRA_VER}-SYN-{i:04d}", "MedDRA", MEDDRA_VER, vb,
                    term, "PT", code, tid, term,
                    json.dumps(MEDDRA_HIER[hk], separators=(",", ":")),
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
# Study terms - the INPUT verbatims to encode (status=open)
# ---------------------------------------------------------------------------
STUDY_HEADER = ["record_id", "source_study", "source_domain", "verbatim",
                "encoding_dictionary", "encoding_dictionary_version",
                "from_source", "derivation_only", "status", "created_at_ts"]

# (study, domain, verbatim, dict, version, from_source, derivation_only)
STUDY_INPUT = [
    # Cases A-I: one per branch of the workflow.
    (STUDY_ONCO, "AE", "Dislocated shoulder", "MedDRA", MEDDRA_VER, "EDC", "False"),
    (STUDY_ONCO, "AE", "Hypothyroid", "MedDRA", MEDDRA_VER, "EDC", "False"),
    (STUDY_ONCO, "AE", "HAEMORRHAGE", "MedDRA", MEDDRA_VER, "EDC", "False"),
    (STUDY_ONCO, "AE", "migrane", "MedDRA", MEDDRA_VER, "EDC", "False"),
    (STUDY_ONCO, "AE", "flutters in my chest sometimes", "MedDRA", MEDDRA_VER, "EDC", "False"),
    (STUDY_ONCO, "AE", "asdfghjkl", "MedDRA", MEDDRA_VER, "EDC", "False"),
    (STUDY_ONCO, "CM", "ibuprofen", "WHODrug", WHODRUG_VER, "EDC", "False"),
    (STUDY_ONCO, "CM", "FULVESTRANT", "WHODrug", WHODRUG_VER, "EDC", "True"),
    (STUDY_GI, "CM", "nexiuum", "WHODrug", WHODRUG_VER, "EDC", "False"),
    # Cases J/K: THE SAME VERBATIM in two different studies. Similarity search
    # returns both "Muscle spasms" and "Abdominal pain" as plausible; only the
    # study context separates them.
    (STUDY_ONCO, "AE", "cramps", "MedDRA", MEDDRA_VER, "EDC", "False"),
    (STUDY_GI, "AE", "cramps", "MedDRA", MEDDRA_VER, "EDC", "False"),
    # Case L: cardiac study, lay description of a rhythm event.
    (STUDY_CARD, "AE", "heart races when I stand up", "MedDRA", MEDDRA_VER, "EDC", "False"),
]

with open(os.path.join(HERE, "study_terms_input.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(STUDY_HEADER)
    for i, (study, dom, vb, d, ver, src, do) in enumerate(STUDY_INPUT, 1):
        site = f"{1000+i}"
        rid = f"{study};{src};{site};{site}0{i:02d};eg_SCREENING;ev_SCREENING;1;{dom};{20+i};1"
        w.writerow([rid, study, dom, vb, d, ver, src, do, "open", "1779681573"])


# ---------------------------------------------------------------------------
# Study metadata - what each trial is about, in prose. Read by get_study_info
# so the agent can break ties between candidate terms that similarity search
# alone cannot separate.
#
# The three descriptions are deliberately CONTRASTING: each one makes a
# different body system the "expected" reading of an ambiguous verbatim. That
# is what makes cases J and K resolve to different codes for identical input.
# ---------------------------------------------------------------------------
STUDY_METADATA = [
    (1, STUDY_ONCO,
     "Phase 3 randomized open-label study of fulvestrant plus a CDK4/6 inhibitor "
     "in postmenopausal women with hormone-receptor-positive, HER2-negative "
     "advanced or metastatic breast cancer who progressed on prior endocrine "
     "therapy. Adverse events of special interest include neutropenia, "
     "hepatotoxicity, QT prolongation and other cardiac rhythm disturbances, "
     "injection-site reactions, hot flushes, and MUSCULOSKELETAL events - muscle "
     "cramps, spasms, myalgia and arthralgia are frequently reported on endocrine "
     "therapy and are actively monitored. Concomitant medications are commonly "
     "analgesics, antiemetics, bisphosphonates, and endocrine agents. "
     "Gastrointestinal events are not a study endpoint and are recorded only if "
     "serious."),
    (2, STUDY_CARD,
     "Phase 2 double-blind study of an investigational antiarrhythmic agent in "
     "adults with symptomatic paroxysmal atrial fibrillation and preserved "
     "ejection fraction. Adverse events of special interest are CARDIAC RHYTHM "
     "events - atrial fibrillation recurrence, cardiac flutter, palpitations, "
     "tachycardia, bradycardia and QT prolongation - together with dizziness and "
     "syncope, which are monitored as proarrhythmia surrogates. Subjects report "
     "rhythm symptoms in lay language and these are coded to the cardiac "
     "disorders SOC. Concomitant medications are commonly beta blockers, oral "
     "anticoagulants and diuretics."),
    (3, STUDY_GI,
     "Phase 3 study of a proton pump inhibitor maintenance regimen in adults with "
     "erosive gastro-oesophageal reflux disease. Adverse events of special "
     "interest are UPPER GASTROINTESTINAL events - abdominal pain and cramping, "
     "dyspepsia, reflux, nausea and diarrhoea. Abdominal cramping is an expected "
     "and frequently reported symptom in this population. Concomitant medications "
     "are commonly proton pump inhibitors (esomeprazole, omeprazole), antacids "
     "and prokinetic agents; antifibrinolytics are not expected in this "
     "population. Musculoskeletal events are not a study endpoint."),
]

with open(os.path.join(HERE, "study_metadata.csv"), "w", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
    w.writerow(["id", "study_name", "study_description"])
    for sid, name, desc in STUDY_METADATA:
        w.writerow([sid, name, desc])


# ---------------------------------------------------------------------------
# Encoded output examples (the OUTPUT shape)
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
     "Migraine headaches", "Headaches", "Nervous system disorders", "Y", MACHINE, "0.99"),
    ("flutters in my chest sometimes", "Pending Approval", "MedDRA v27.0",
     "Cardiac flutter", "Cardiac flutter", "10052840", "Rate and rhythm disorders NEC",
     "Cardiac arrhythmias", "Cardiac disorders", "Y", MACHINE, "0.88"),
    ("cramps", "Pending Approval", "MedDRA v27.0", "Muscle spasms", "Muscle spasms",
     "10028334", "Muscle related signs and symptoms",
     "Musculoskeletal and connective tissue disorders NEC",
     "Musculoskeletal and connective tissue disorders", "Y", MACHINE, "0.82"),
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
    ("nexiuum", "Coded", "GLOBAL-2024", "ESOMEPRAZOLE", "00201501001",
     "NEXIUM", "00201501382", "ESOMEPRAZOLE", "autocoded", MACHINE, "0.98"),
]
with open(os.path.join(HERE, "encoded_cm_whodrug.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(CM_HEADER)
    w.writerows(CM_ROWS)


# ---------------------------------------------------------------------------
# Golden walkthrough - one trace per case, stage by stage (the "unit tests").
#
# match_score on the agent path is the agent's own CODING CONFIDENCE, not the
# retrieval cosine similarity - see the SystemPrompt in
# state-machine/coding-workflow.asl.yaml. Retrieval similarity for a
# misspelling is low even when the coding decision is obvious, so the two
# numbers are not interchangeable and cannot be compared to the same
# thresholds.
# ---------------------------------------------------------------------------
GOLD_HEADER = ["case_id", "case_name", "stage", "table", "study", "verbatim",
               "dict_term", "dict_term_type", "dict_term_code", "derivation",
               "status", "match_score", "notes"]
GOLD = [
    # CASE A: exact match -> autocoded (deterministic)
    ("A", "exact_match_autocoded", "input", "study_terms", STUDY_ONCO,
     "Dislocated shoulder", "", "", "", "", "open", "",
     "AE verbatim ingested from EDC awaiting coding"),
    ("A", "exact_match_autocoded", "tna_guard", "terms_not_to_autocode", STUDY_ONCO,
     "Dislocated shoulder", "", "", "", "", "", "", "no block-list hit -> continue"),
    ("A", "exact_match_autocoded", "exact_match", "dictionary_terms", STUDY_ONCO,
     "Dislocated shoulder", "Dislocated shoulder", "LLT", "10013156",
     "Dislocated shoulder", "", "1.00",
     "unique LLT exact match; carries promotion to PT Joint dislocation (10023204)"),
    ("A", "exact_match_autocoded", "output", "study_terms", STUDY_ONCO,
     "Dislocated shoulder", "Dislocated shoulder", "LLT", "10013156",
     "Dislocated shoulder", "autocoded", "1.00",
     "status_changed_by=autocoding-workflow (machine coded, no human, no LLM)"),

    # CASE B: synonym match -> autocoded
    ("B", "synonym_match_autocoded", "input", "study_terms", STUDY_ONCO,
     "Hypothyroid", "", "", "", "", "open", "",
     "'Hypothyroid' is not a valid MedDRA term on its own"),
    ("B", "synonym_match_autocoded", "synonym", "synonym_list", STUDY_ONCO,
     "Hypothyroid", "Hypothyroidism", "PT", "10021114", "Hypothyroidism",
     "active", "1.00", "curated synonym pins verbatim to real PT code 10021114"),
    ("B", "synonym_match_autocoded", "output", "study_terms", STUDY_ONCO,
     "Hypothyroid", "Hypothyroidism", "PT", "10021114", "Hypothyroidism",
     "autocoded", "1.00", "synonym-driven exact match; machine coded"),

    # CASE C: TNA block -> open
    ("C", "tna_block_open", "input", "study_terms", STUDY_ONCO, "HAEMORRHAGE",
     "", "", "", "", "open", "", "verbatim ingested awaiting coding"),
    ("C", "tna_block_open", "tna_guard", "terms_not_to_autocode", STUDY_ONCO,
     "HAEMORRHAGE", "", "", "", "", "active", "",
     "BLOCK-list hit -> autocoder returns nothing, checked BEFORE any match"),
    ("C", "tna_block_open", "output", "study_terms", STUDY_ONCO, "HAEMORRHAGE",
     "", "", "", "", "open", "",
     "stays open for a human coder (safety block, not 'no match')"),

    # CASE D: agent semantic search -> autocoded (high confidence)
    ("D", "agent_semantic_autocoded", "input", "study_terms", STUDY_ONCO, "migrane",
     "", "", "", "", "open", "", "typo of 'migraine'; no exact/synonym hit"),
    ("D", "agent_semantic_autocoded", "agent_search", "dictionary_terms", STUDY_ONCO,
     "migrane", "Migraine", "PT", "10027599", "Migraine", "", "0.99",
     "retrieval cosine is only ~0.37 (a misspelling is lexically distant) but the "
     "coding decision is unambiguous, so the agent's CONFIDENCE is high -> autocode"),
    ("D", "agent_semantic_autocoded", "output", "study_terms", STUDY_ONCO, "migrane",
     "Migraine", "PT", "10027599", "Migraine", "autocoded", "0.99",
     "machine coded via agent path"),

    # CASE E: agent semantic search -> approval_required (medium confidence)
    ("E", "agent_semantic_review", "input", "study_terms", STUDY_ONCO,
     "flutters in my chest sometimes", "", "", "", "", "open", "",
     "verbose lay description; no exact/synonym hit"),
    ("E", "agent_semantic_review", "agent_search", "dictionary_terms", STUDY_ONCO,
     "flutters in my chest sometimes", "Cardiac flutter", "PT", "10052840",
     "Cardiac flutter", "", "0.88",
     "competing rhythm candidates (Palpitations, Tachycardia); study lists cardiac "
     "rhythm disturbances as an AESI -> confident but not certain"),
    ("E", "agent_semantic_review", "output", "study_terms", STUDY_ONCO,
     "flutters in my chest sometimes", "Cardiac flutter", "PT", "10052840",
     "Cardiac flutter", "approval_required", "0.88",
     "routed to a human coder for one-click confirm/override"),

    # CASE F: no confident match -> open
    ("F", "no_confident_match_open", "input", "study_terms", STUDY_ONCO, "asdfghjkl",
     "", "", "", "", "open", "", "garbage verbatim"),
    ("F", "no_confident_match_open", "agent_search", "dictionary_terms", STUDY_ONCO,
     "asdfghjkl", "", "", "", "", "", "<0.70",
     "no candidate is a credible clinical match -> confidence below review threshold"),
    ("F", "no_confident_match_open", "output", "study_terms", STUDY_ONCO, "asdfghjkl",
     "", "", "", "", "open", "",
     "left open for manual coding (score not persisted on the open path)"),

    # CASE G: WHODrug exact -> autocoded
    ("G", "whodrug_exact_autocoded", "input", "study_terms", STUDY_ONCO, "ibuprofen",
     "", "", "", "", "open", "", "con-med verbatim, WHODrug"),
    ("G", "whodrug_exact_autocoded", "exact_match", "dictionary_terms", STUDY_ONCO,
     "ibuprofen", "IBUPROFEN", "generic name", "00109201001", "IBUPROFEN", "", "1.00",
     "unique generic-name exact match; ATC M01AE PROPIONIC ACID DERIVATIVES"),
    ("G", "whodrug_exact_autocoded", "output", "study_terms", STUDY_ONCO, "ibuprofen",
     "IBUPROFEN", "generic name", "00109201001", "IBUPROFEN", "autocoded", "1.00",
     "machine coded"),

    # CASE H: derivation_only -> derivation + hierarchy only
    ("H", "derivation_only", "input", "study_terms", STUDY_ONCO, "FULVESTRANT",
     "", "", "", "", "open", "", "derivation_only=True (from_source=EDC + dict=WHODrug)"),
    ("H", "derivation_only", "exact_match", "dictionary_terms", STUDY_ONCO,
     "FULVESTRANT", "FULVESTRANT", "generic name", "01503001001", "FULVESTRANT",
     "", "1.00", "exact 1:1 match required; ATC L02BA ANTI-ESTROGENS"),
    ("H", "derivation_only", "output", "study_terms", STUDY_ONCO, "FULVESTRANT",
     "", "", "", "FULVESTRANT", "autocoded", "1.00",
     "updates ONLY derivation + ATC hierarchy, never a new dict_term"),

    # CASE I: two lexically-near trade names, study context breaks the tie
    ("I", "agent_near_miss_trade_name", "input", "study_terms", STUDY_GI, "nexiuum",
     "", "", "", "", "open", "", "misspelling of a trade name; WHODrug con-med"),
    ("I", "agent_near_miss_trade_name", "agent_search", "dictionary_terms", STUDY_GI,
     "nexiuum", "NEXIUM", "trade name", "00201501382", "ESOMEPRAZOLE", "", "0.98",
     "search returns BOTH 'NEXIM' (tranexamic acid, an antifibrinolytic) and "
     "'NEXIUM' (esomeprazole, a PPI) - lexically near-identical to the verbatim. "
     "get_study_info reports a reflux study whose expected con-meds are PPIs and "
     "which explicitly does not expect antifibrinolytics, so the choice is "
     "unambiguous once context is applied -> high confidence"),
    ("I", "agent_near_miss_trade_name", "output", "study_terms", STUDY_GI, "nexiuum",
     "NEXIUM", "trade name", "00201501382", "ESOMEPRAZOLE", "autocoded", "0.98",
     "autocoded: the misspelling has exactly one clinically plausible reading in "
     "this study. Contrast with cases J/K/L, where several candidates remain "
     "plausible after context and the workflow routes to human review"),

    # CASES J/K: the SAME verbatim, two studies, two different correct codes.
    ("J", "study_context_musculoskeletal", "input", "study_terms", STUDY_ONCO,
     "cramps", "", "", "", "", "open", "",
     "ambiguous lay term: could be muscle cramps OR abdominal cramping"),
    ("J", "study_context_musculoskeletal", "agent_search", "dictionary_terms",
     STUDY_ONCO, "cramps", "Muscle spasms", "PT", "10028334", "Muscle spasms",
     "", "0.85-0.92",
     "search returns Muscle spasms, Myalgia AND Abdominal pain as plausible; "
     "get_study_info reports an endocrine-therapy breast cancer study actively "
     "monitoring muscle cramps/spasms, GI events not an endpoint -> Muscle spasms"),
    ("J", "study_context_musculoskeletal", "output", "study_terms", STUDY_ONCO,
     "cramps", "Muscle spasms", "PT", "10028334", "Muscle spasms",
     "autocoded|approval_required", "0.85-0.92",
     "SAME verbatim as case K, DIFFERENT code - the study context is the only "
     "thing that separates them. ASSERT ON dict_term_code, NOT status: the term "
     "is stable across runs but the model-authored confidence straddles the 0.90 "
     "gate (observed 0.85/0.85/0.88/0.88/0.92 over five identical runs)"),

    ("K", "study_context_gastrointestinal", "input", "study_terms", STUDY_GI,
     "cramps", "", "", "", "", "open", "",
     "identical verbatim to case J, different study"),
    ("K", "study_context_gastrointestinal", "agent_search", "dictionary_terms",
     STUDY_GI, "cramps", "Abdominal pain", "PT", "10000081", "Abdominal pain",
     "", "0.80-0.92",
     "same candidate set as case J; get_study_info reports a reflux study where "
     "abdominal cramping is an expected AESI and musculoskeletal events are not "
     "an endpoint -> Abdominal pain"),
    ("K", "study_context_gastrointestinal", "output", "study_terms", STUDY_GI,
     "cramps", "Abdominal pain", "PT", "10000081", "Abdominal pain",
     "autocoded|approval_required", "0.80-0.92",
     "THE demonstration case: identical input to J, different code, driven "
     "entirely by the study metadata the second tool supplies. Assert on "
     "dict_term_code - the status depends on where the run's confidence lands "
     "relative to the 0.90 gate"),

    # CASE L: cardiac study, lay rhythm description
    ("L", "study_context_cardiac", "input", "study_terms", STUDY_CARD,
     "heart races when I stand up", "", "", "", "", "open", "",
     "lay rhythm description in an arrhythmia study"),
    ("L", "study_context_cardiac", "agent_search", "dictionary_terms", STUDY_CARD,
     "heart races when I stand up", "Tachycardia", "PT", "10043071", "Tachycardia",
     "", "0.85",
     "competing rhythm candidates (Palpitations, Cardiac flutter, Atrial "
     "fibrillation); 'races' maps to rate, and the study codes lay rhythm "
     "symptoms to the cardiac SOC -> Tachycardia"),
    ("L", "study_context_cardiac", "output", "study_terms", STUDY_CARD,
     "heart races when I stand up", "Tachycardia", "PT", "10043071", "Tachycardia",
     "approval_required", "0.85",
     "review-tier: lay language mapped to a specific rhythm term warrants "
     "human confirmation"),
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
