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

## 3. Synonym List, Block-List, Study Terms, and Study Metadata

- **Source:** Authored for this repository; not sourced from any real trial,
  sponsor, or coding standard. The study description in
  `data/study_metadata.csv` describes a fictional trial.
- **Files:** `data/synonym_list.csv`, `data/terms_not_to_autocode.csv`,
  `data/study_terms_input.csv`, `data/study_metadata.csv`,
  `data/golden_walkthrough.csv`
- **Usage in this sample:** Illustrative fixtures that exercise every branch of
  the coding workflow (exact match, synonym match, block-list, semantic search
  at varying confidence, derivation-only mode). Entirely fabricated — see
  [DISCLAIMER.md](DISCLAIMER.md).

---

_This document is intentionally sparse where source terms, retrieval dates, or
license specifics have not been independently confirmed. Update the entries
above with exact license references and retrieval dates before treating this
file as a compliance record._

---

## UNRESOLVED: dictionary licensing must be confirmed before publication

**Status: open. Requires a human decision — this cannot be settled from the
code.**

What the repository actually contains, verified 2026-07-28:

| | Count | Code format |
|---|---|---|
| MedDRA terms (`data/dictionary_terms_meddra.csv`) | **32** | real 8-digit codes, e.g. `10027599` (Migraine) |
| WHODrug terms (`data/dictionary_terms_whodrug.csv`) | **12** | real 11-digit codes, e.g. `00201501382` (NEXIUM) |

Two facts that make this a genuine question rather than a theoretical one:

1. **These are real codes, not placeholders.** An earlier revision of the
   fixtures used deliberately synthetic identifiers (`SAMPLE-LLT-0001`) as a
   fabrication canary. Those are now **entirely gone** — a search for
   `SAMPLE-`/`FAKE-`/`TEST-` across `data/` returns zero matches. Every code
   is in real dictionary format and, as far as can be told without a license,
   corresponds to a genuine term.
2. **MedDRA and WHODrug are both proprietary and licensed** (MSSO/IFPMA and
   Uppsala Monitoring Centre respectively), and this repository is public
   under `aws-samples`.

"De minimis illustrative use" is the position the docs currently assert. That
may well be defensible — 44 terms out of tens of thousands, chosen to show
data shape rather than to substitute for a license — but **nobody with
authority to make that call has confirmed it**, and this file should not be
read as evidence that they have.

Options, in increasing order of safety:

- **A — Confirm and cite.** Obtain written confirmation from whoever holds
  the org's MedDRA/WHODrug license that this quantity and use qualifies, and
  record the reference here. Keeps the fixtures as-is.
- **B — Reduce further.** Cut the dictionary to the minimum that still
  exercises every branch (roughly 12–15 terms), lowering exposure.
- **C — Return to synthetic codes** (recommended if A can't be obtained
  quickly). Restore fabricated identifiers with real *structure* but invented
  values. Costs nothing architecturally — the workflow never validates codes
  against an external source — and removes the question entirely. The
  trade-off is that readers can no longer sanity-check a code against a real
  dictionary.

Until one of these is chosen and recorded here, treat publication as blocked.

## General Disclaimer

This project is not affiliated with, endorsed by, or officially connected to
the MSSO, IFPMA, UMC, or the WHO. See [DISCLAIMER.md](DISCLAIMER.md) for the
full scope statement.
