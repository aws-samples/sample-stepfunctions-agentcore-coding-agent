# Reference Data Sources

This file documents the origin, license/access terms, and usage of every
reference data file bundled in this repository. No real patient data is used
anywhere — see [DISCLAIMER.md](DISCLAIMER.md) for the full scope statement.

---

## 1. MedDRA (Medical Dictionary for Regulatory Activities)

- **Source:** MSSO (Maintenance and Support Services Organization) / IFPMA
- **URL:** https://www.meddra.org/
- **License/terms:** MedDRA is a proprietary, licensed dictionary. Use requires a
  subscription/license from the MSSO.
- **Usage in this sample:** `data/dictionary_terms_meddra.csv` contains a de
  minimis set of real MedDRA terms and codes, reproduced illustratively to show
  the data shape (LLT/PT levels, SOC→HLGT→HLT→PT hierarchy) needed by the
  workflow — not a redistributable dictionary extract. See
  [DISCLAIMER.md](DISCLAIMER.md).

## 2. WHODrug Global

- **Source:** Uppsala Monitoring Centre (UMC), on behalf of the WHO
- **URL:** https://who-umc.org/whodrug/
- **License/terms:** WHODrug is a proprietary, licensed dictionary. Use requires
  a subscription/license from UMC.
- **Usage in this sample:** `data/dictionary_terms_whodrug.csv` contains a de
  minimis set of real WHODrug terms and codes (trade name / generic name, ATC
  hierarchy), reproduced illustratively to show data shape — not a
  redistributable dictionary extract. See [DISCLAIMER.md](DISCLAIMER.md).

## 3. Synonym List, Block-List, and Study Terms

- **Source:** Authored for this repository; not sourced from any real trial,
  sponsor, or coding standard.
- **Files:** `data/synonym_list.csv`, `data/terms_not_to_autocode.csv`,
  `data/study_terms_input.csv`, `data/golden_walkthrough.csv`
- **Usage in this sample:** Illustrative fixtures that exercise every branch of
  the coding workflow (exact match, synonym match, block-list, semantic search
  at varying confidence, derivation-only mode). Entirely fabricated — see
  [DISCLAIMER.md](DISCLAIMER.md).

---

_This document is intentionally sparse where source terms, retrieval dates, or
license specifics have not been independently confirmed. Update the entries
above with exact license references and retrieval dates before treating this
file as a compliance record._

## General Disclaimer

This project is not affiliated with, endorsed by, or officially connected to
the MSSO, IFPMA, UMC, or the WHO. See [DISCLAIMER.md](DISCLAIMER.md) for the
full scope statement.
