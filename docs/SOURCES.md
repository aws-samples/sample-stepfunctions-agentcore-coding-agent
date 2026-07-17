# Reference Data Sources

This file documents the origin, license/access terms, and usage of every external
reference data file bundled in this repository. No real PHI is used anywhere — all
data is either public CMS/X12 reference material or official CMS synthetic
("realistic-but-not-real") data.

---

## 1. ICD-10-CM Code Descriptions

- **Source:** Centers for Medicare & Medicaid Services (CMS)
- **URL:** https://www.cms.gov/medicare/coding-billing/icd-10-codes
- **Direct file used:** https://www.cms.gov/files/zip/2027-code-descriptions-tabular-order.zip
- **Format:** ZIP containing fixed-width text file
- **License/terms:** Public domain — U.S. government work. ICD-10-CM is maintained by
  CDC/NCHS and CMS and is free to use without license or fee.
- **Retrieved:** _fill in date downloaded_
- **Usage in this sample:** A small subset (~20-30 codes) is extracted for the coding
  agent's `icd10_lookup` tool, limited to the illustrative respiratory/office-visit
  scenario used throughout this sample (see [DISCLAIMER.md](DISCLAIMER.md)). The full
  file (70,000+ codes) is not bundled or used in its entirety.

## 2. CARC (Claim Adjustment Reason Codes)

- **Source:** X12 (Washington Publishing Company / X12 standards body)
- **URL:** https://www.x12.org/codes/claim-adjustment-reason-codes
- **Format:** HTML table (no downloadable file published)
- **License/terms:** Publicly viewable code list maintained by X12; codes are standard
  identifiers used industry-wide in HIPAA-mandated 835 transactions. No authentication
  or fee required to view.
- **Retrieved:** _fill in date_
- **Usage in this sample:** A subset of codes (see
  `reference-data/processed/carc-codes.json`) is used by the `parse835` Lambda to
  classify denials as "minor/correctable" vs. "appealable" for illustration. This is a
  simplified two-bucket classification — see [DISCLAIMER.md](DISCLAIMER.md).

## 3. RARC (Remittance Advice Remark Codes)

- **Source:** X12 (Washington Publishing Company / X12 standards body)
- **URL:** https://www.x12.org/codes/remittance-advice-remark-codes
- **Format:** HTML table (no downloadable file published)
- **License/terms:** Same as CARC above — publicly viewable, standard industry codes.
- **Retrieved:** _fill in date_
- **Usage in this sample:** A small illustrative subset supplements the CARC
  classification with additional denial-reason detail where needed.

## 4. NCCI (National Correct Coding Initiative) Bundling Edits

- **Source:** Centers for Medicare & Medicaid Services (CMS)
- **URL:** https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits
- **Format:** Quarterly-updated CSV/Excel files (direct file URLs change each quarter
  and require manual navigation from the page above — no stable direct-download link
  was available at the time this sample was written)
- **License/terms:** Public domain, U.S. government work.
- **Usage in this sample:** Rather than bundling the full quarterly edit table (large,
  and intended for production claims-processing systems), this sample uses 3-4
  hand-picked, illustrative CPT code bundling pairs (see
  `reference-data/processed/ncci-illustrative-edits.json`) to demonstrate the *pattern*
  of a bundling-edit check. This is explicitly not a complete or current NCCI edit
  implementation — see [DISCLAIMER.md](DISCLAIMER.md).

## 5. CMS Synthetic Medicare Claims Data

- **Source:** Centers for Medicare & Medicaid Services (CMS)
- **Collection page:** https://data.cms.gov/collection/synthetic-medicare-enrollment-fee-for-service-claims-and-prescription-drug-event
- **Direct file used (example):** https://data.cms.gov/sites/default/files/2023-04/a3969dcf-0799-49fe-8380-9eef788d5ac4/pde.csv
- **Format:** CSV
- **License/terms:** Explicitly published by CMS as public, unrestricted
  "realistic-but-not-real-data," designed for exactly this kind of use (software
  testing, education, feasibility assessment). CMS states this data "can be released
  publicly without restrictions." Not for clinical or scientific inference (per CMS's
  own disclaimer).
- **Retrieved:** _fill in date_
- **Usage in this sample:** Seeds the sample encounter and 835-denial test fixtures in
  `test/fixtures/`, giving the demo data a real-world-shaped (but entirely synthetic)
  structure rather than hand-invented values.

## 6. Payer Billing Policy Documents (for Bedrock Knowledge Base)

- **Source:** Not sourced from any real payer. Authored as illustrative sample
  documents for this repository.
- **Usage in this sample:** Indexed into a Bedrock Knowledge Base to support the coding
  agent's `search_billing_policy` tool. Explicitly fictional — see
  [DISCLAIMER.md](DISCLAIMER.md). Do not treat as representative of any real payer's
  actual coverage policy.

---

## General Disclaimer

All CMS and X12 sources above are used strictly as free, publicly available reference
material. This project is not affiliated with, endorsed by, or officially connected to
CMS, X12, or any health insurance payer. See [DISCLAIMER.md](DISCLAIMER.md) for the
full scope statement.
