# Scope and Disclaimer

This sample uses a simplified clinical medical-coding scenario to demonstrate an
AWS architecture pattern: orchestrating deterministic workflow logic (AWS Step
Functions) with bounded agentic reasoning (Amazon Bedrock AgentCore Harness).

**This is not a certified or production-ready medical coding solution.**
Specifically:

- Dictionary coverage (MedDRA terms in `data/dictionary_terms_meddra.csv`, WHODrug
  terms in `data/dictionary_terms_whodrug.csv`) is a de minimis illustrative set —
  a handful of terms chosen to exercise every branch of the workflow, not a
  redistributable extract of either licensed dictionary. Production coding
  requires the full, currently licensed MedDRA and/or WHODrug dictionary for the
  version in use.
- The synonym list (`data/synonym_list.csv`) and block-list
  (`data/terms_not_to_autocode.csv`) are illustrative fixtures authored for this
  repository, not a curated clinical coding standard. A real deployment's
  synonym and block-list content should be governed by qualified medical coders.
- The 0.90 / 0.70 confidence thresholds in
  `state-machine/coding-workflow.asl.yaml` are illustrative starting points, not
  values validated against a production dictionary or verbatim distribution. Note
  also that the score they route on is the agent's **self-reported coding
  confidence**, not a calibrated probability — see "How `score` is defined" in the
  [README](../README.md) for the controls that bound this.
- The three studies in `data/study_metadata.csv` and their descriptions are
  fabricated, and are written specifically to make study context decisive for the
  ambiguous verbatims in the golden walkthrough (cases I, J, K, L). Real study
  metadata is rarely this tidy; a production deployment should expect noisier,
  longer protocol text and validate that the agent still uses it correctly.
- No real patient, subject, or site data is used. The study/site/subject
  identifiers and free-text verbatims in `data/study_terms_input.csv` and
  `data/golden_walkthrough.csv` are entirely fabricated for this sample.

Consult qualified medical coding professionals, and your organization's current
MedDRA/WHODrug license terms, before adapting any part of this pattern for
production use.
