# Known Issues

Open items, each found by running this sample end to end against a live
deployment in `us-east-1` rather than by reading the code. Fixed items are
listed at the bottom for context.

Ordered by how likely they are to mislead someone.

---

## 1. Retrieval recall: the clinically best term can be absent from the candidate set

**Severity: high. Deferred pending hybrid lexical search.**

The agent is instructed to choose only from the candidates
`search_dictionary` returns. That is the right anti-fabrication constraint,
but it means a term that vector search fails to surface can never be selected
— no amount of prompt tuning or study context recovers it.

Observed on case E, verbatim `flutters in my chest sometimes`:

| Rank | Term | Similarity |
|---|---|---|
| 1 | Cardiac flutter | 0.6512 |
| 2 | Atrial fibrillation | 0.2182 |
| 10 | Tachycardia | 0.1057 |
| … | | |
| **19** | **Palpitations** | **0.0655** |

The agent requested `top_k:10` and coded this to **Cardiac flutter** — a
specific ECG-diagnosable arrhythmia. But a patient reporting a *sensation* of
fluttering would conventionally be coded to **Palpitations**, which sits at
**rank 19**, below Nausea, Diarrhoea, Vomiting and Dislocated shoulder — terms
with no relationship to the complaint. It was never on the menu.

Note this is a **recall** failure, not an adjudication failure. Reranking
reorders what retrieval returns and cannot rescue a term retrieval never
surfaced, so the earlier reranking investigation does not address this.

Options:
- **Cheap partial mitigation:** raise the default `top_k` in the tool, or
  instruct a wider search in the prompt. Reduces but does not eliminate the
  problem — Palpitations at rank 19 needs `top_k >= 19` out of 32 terms, which
  at real dictionary scale is not a meaningful filter.
- **Real fix (deferred):** hybrid search — lexical/BM25 alongside vector, or a
  dictionary-aware synonym expansion step. `flutters` → `Palpitations` is a
  known clinical equivalence that a lexical/curated path catches and embedding
  similarity does not.

Worth stating plainly in any write-up: on this fixture, **vector similarity
alone did not reliably surface the clinically correct term**.

---

## 2. `open` conflates "decided not to code" with "something broke"

**Severity: medium. Partially mitigated.**

`status = 'open'` is reached from four different situations:

1. Block-list hit (deliberate safety block)
2. Agent confidence below the review floor (deliberate)
3. A Catch after an infrastructure error (**not** deliberate)
4. A malformed agent reply that failed `$parse` (**not** deliberate)

Cases 1–2 are correct outcomes. Cases 3–4 are failures wearing the same
costume, and every execution still reports `SUCCEEDED`.

**Partially mitigated:** `MarkOpen` now receives a `failure_reason` and
records it as `status_changed_by = 'autocoding-workflow:error:<Error>'`, so
the distinction survives in the row rather than only in the execution history.

**Still open:** a queue built on `WHERE status = 'open'` will still hand
error rows to human coders as though they were genuinely uncodable. A
dedicated status (`coding_failed`) or a boolean column would be cleaner than
encoding the reason in `status_changed_by`. Deferred because it changes the
`study_terms` schema and therefore the downstream contract.

---

## 3. The autocode/review boundary is non-deterministic

**Severity: medium. Design tradeoff, not a bug — but must be disclosed.**

Confidence is authored by the model, and four of six agent cases land within
0.10 of the 0.90 autocode gate. Two runs of identical input:

| Case | Run 1 | Run 2 | Status flipped? |
|---|---|---|---|
| E flutters | 0.82 → approval_required | **0.91 → autocoded** | **yes** |
| J cramps @ ONCO | 0.92 → autocoded | **0.85 → approval_required** | **yes** |
| L heart races | 0.82 | 0.85 | no |
| K cramps @ GI | 0.82 | 0.82 | no |
| D migrane | 0.98 | 0.98 | no |
| I nexiuum | 0.98 | 0.98 | no |

**The selected `dict_term_code` was identical in every run** — only the
confidence moved, and with it whether a human sees the record. Instability is
confined to genuinely borderline cases, which is defensible behaviour but not
reproducible.

Consequences: the repo's tests assert on `dict_term_code`, not `status`; and
case E — the one where a human most needs to look — is precisely the one that
sometimes skips review.

A cross-encoder reranker would give a deterministic, better-calibrated score.
Measured on an earlier fixture, Cohere Rerank 3.5 corrected the ordering that
raw cosine got backwards, though on a single model and 11 terms only.

---

## 4. `dictionarySearch` has no Aurora resume retry

**Severity: low-medium.**

`scripts/seed.ts` retries `DatabaseResumingException`; the tool Lambdas do
not. The first call after the cluster auto-pauses therefore fails inside the
agent loop. Largely masked now that `serverlessV2MinCapacity` is 0.5 and the
state machine retries the relevant error codes, but the Lambda itself should
handle it rather than relying on the workflow to paper over it.

---

## 5. `writeBack` cannot verify candidate membership

**Severity: low. Platform limitation.**

`writeBack` confirms the selected code **exists** in the target dictionary and
version. It cannot confirm the code was among the candidates
`search_dictionary` actually returned, because `invokeHarness` returns only
the model's final message — not its tool results.

AgentCore observability now logs tool arguments and results to CloudWatch, so
this is auditable **after the fact**, but the workflow still cannot enforce it
inline. Case K illustrates the gap: the chosen code (Abdominal pain, rank 9)
was legitimate, but nothing in the workflow could have proven that at the
time.

---

## 6. `cdk synth` still emits W9008 after the encryption fix

**Severity: cosmetic, but actively confusing.**

`storageEncrypted: true` is set on the `AWS::RDS::DBCluster` and is verified
live (`StorageEncrypted: true`, KMS-backed). W9008 nonetheless still fires,
because it targets the `AWS::RDS::DBInstance` writer, where `StorageEncrypted`
is unset — correct for Aurora, since encryption is a cluster-level property.

The warning is a false positive for the instance. Either suppress it
explicitly or note it in the README, because a reader who runs `synth`, sees
the warning, and reads the construct comment claiming the fix silences it will
reasonably conclude something is broken.

---

## 7. Dependency advisory that cannot be fixed here

**Severity: low. Verified unfixable at this time.**

One high-severity finding survives `npm ci`: `brace-expansion` 5.0.7
(GHSA-mh99-v99m-4gvg) vendored inside `aws-cdk-lib`.

Verified 2026-07-28:
- `aws-cdk-lib@2.262.1` is the **latest published** version and still vendors
  5.0.7 — there is no newer release to upgrade to.
- `aws-cdk-lib` sets `bundleDependencies`, so npm `overrides` cannot reach
  inside it. The `overrides` pin clears the other 19 findings.
- Build-time only: the vendored copy appears in **no** synthesized Lambda
  bundle under `cdk.out/asset.*/index.js`, so it is not deployed.
- Nothing in this repo expands untrusted brace patterns.

**Do not run `npm audit fix`** — it proposes downgrading jest to 25.x.
Re-check on each `aws-cdk-lib` bump and drop this once upstream ships
>= 5.0.8.

---

## 8. Dictionary licensing is unconfirmed

**Severity: blocking for publication. See [SOURCES.md](SOURCES.md).**

The fixtures contain 32 MedDRA and 12 WHODrug terms with **real codes in real
format** — the earlier synthetic `SAMPLE-` prefixes are gone. Both
dictionaries are proprietary and licensed; this repository is public. The
"de minimis illustrative use" position may be defensible but has not been
confirmed by anyone with authority to confirm it.

---

# Fixed

- **Retry gaps causing silent false passes.** A burst of 12 concurrent
  executions against a cold 0-ACU cluster failed 8 of 12 — 7x
  `Sandbox.Timedout` at the 30s Lambda ceiling (one call measured 25.7s) and
  1x `ThrottlingException` — with **every execution reporting SUCCEEDED** and
  every affected row silently marked `open`. None of those errors matched the
  Retry blocks. Fixed by widening every Retry to cover `Lambda.Unknown`,
  `States.Timeout`, `ThrottlingException`, `DatabaseResumingException` and
  `DatabaseUnavailableException`; raising the Lambda timeout 30s → 90s; and
  setting `serverlessV2MinCapacity` 0 → 0.5.
- **The agent emitted no telemetry at all.** The harness execution role had no
  `logs:` permissions, so AgentCore silently wrote nothing and no log group
  existed. Fixed by adopting the execution role from the official
  harness + Step Functions sample (X-Ray, three `logs:` statements,
  namespace-scoped `cloudwatch:PutMetricData`). Observability on a harness is
  **entirely IAM-gated** — `AWS::BedrockAgentCore::Harness` exposes no
  observability property and needs no environment variable.
- **Routing on retrieval similarity instead of coding confidence** — the two
  are inversely ordered on this data, so no threshold pair could work.
- **`$parse` broke on model narration**, silently sending agent-path terms to
  `MarkOpen`; the Assign now extracts the JSON object from the reply.
- **Aurora cluster was unencrypted at rest** (`StorageEncrypted: false`
  confirmed on the live cluster, contrary to the assumption that Aurora
  defaults to encrypted).
