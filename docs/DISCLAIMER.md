# Scope and Disclaimer

This sample uses a simplified medical billing scenario to demonstrate an AWS
architecture pattern: orchestrating deterministic workflow logic (AWS Step Functions)
with bounded agentic reasoning (Amazon Bedrock AgentCore Harness).

**This is not a certified or production-ready billing solution.** Specifically:

- Coding examples (ICD-10, CPT, HCPCS) are simplified, textbook-level illustrations,
  not exhaustive or payer-specific coding guidance.
- Denial/appeal classification logic is a simplified two-bucket example
  (corrected-claim vs. appealable). Production systems require a complete,
  payer-specific rules table.
- CCI edit checks are represented as a small number of hand-picked illustrative
  bundling pairs, not the full CMS quarterly NCCI edit tables. Fee schedules and
  timely-filing windows are placeholder values.
- No real patient data, PHI, or payer information is used. Test fixtures in
  `test/fixtures/` are either synthetic or derived from CMS's own public
  "realistic-but-not-real" synthetic Medicare claims data (see
  [SOURCES.md](SOURCES.md)).
- Payer billing policy documents referenced by the coding agent's Knowledge Base
  are authored as illustrative samples for this repository — they are not sourced
  from, and should not be treated as representative of, any real payer's actual
  coverage policy.

Consult qualified medical billing and coding professionals, and your current
payer agreements, before adapting any part of this pattern for production use.
