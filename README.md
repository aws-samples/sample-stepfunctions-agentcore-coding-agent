# Autocoding: AWS Step Functions + Amazon Bedrock AgentCore Harness

A vendor-neutral reference solution for automating clinical medical coding — mapping
free-text "verbatims" from clinical trial data (e.g. `"migrane"`, `"Hypothyroid"`) to
controlled-vocabulary codes (MedDRA for adverse events, WHODrug for medications) —
using a Step Functions state machine with a declarative Amazon Bedrock AgentCore
Harness step for the cases that need semantic reasoning.

The study/site/subject identifiers and free-text verbatims in `data/` are fabricated; the
dictionary terms and codes are a de minimis illustrative set based on the shape of
real MedDRA (MSSO/IFPMA) and WHODrug (Uppsala Monitoring Centre) records — not a
redistributable dictionary extract. No customer or patient data is included.

---

## Prerequisites

- Node.js 24+ and npm.
- The [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) v2, configured with credentials for the target account (`aws configure` or an SSO profile).
- The AWS CDK CLI — installed via `npm install` below (`aws-cdk` is a dev dependency), or globally with `npm install -g aws-cdk`.
- Your target account/region [bootstrapped for CDK](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) (`npx cdk bootstrap`), if this is the first CDK deploy there.
- `jq` and `uuidgen` — used only by the shell snippets in the testing section below, not by the deploy or seed steps. (`uuidgen` ships with macOS/most Linux distros; `jq` via `brew install jq` / `apt install jq`.)
- Model access enabled in the Amazon Bedrock console for **Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`, used by the seed script and the dictionary-search tool) and **Claude Sonnet** (the harness's `us.anthropic.claude-sonnet-4-6` inference profile — see `lib/constructs/coding-harness.ts`), in the region you deploy to.

## The design pattern

Cheapest-first escalation, with the workflow — not the model — owning every routing
decision:

1. **Deterministic direct lookup** (Lambda, no LLM). A block-list guard runs first:
   an exact hit on `terms_not_to_autocode` means the term is too ambiguous to ever
   auto-assign, and the row stays open for a human. Then an exact/synonym match
   against `dictionary_terms` + `synonym_list` — accepted only if it resolves to
   exactly one distinct code. Most verbatims are coded here, cheaply and
   reproducibly, with a score of 1.00.
2. **Agentic semantic search and adjudication** (AgentCore Harness), only for
   verbatims the deterministic path missed. The harness is declared directly in
   the Step Functions task state — model, system prompt, and two tools exposed
   through an AgentCore Gateway, with no container to build or operate:
   `search_dictionary` (pgvector cosine-similarity search over
   `dictionary_terms`) and `get_study_info` (the study's free-text metadata
   description). The second tool exists because similarity search can return
   several clinically plausible candidates it cannot separate on text alone —
   a human coder breaks that tie using study context, and this gives the agent
   the same context. Choosing among close candidates is the part that resists
   being written as code, which is why this step is an agent rather than
   another Lambda.
3. **Score-threshold routing** (Choice state, configuration not model judgment):
   high confidence autocodes, medium confidence routes to a human review queue,
   low confidence leaves the term open.
4. **Write-back** (Lambda). Persists the outcome onto the *same* `study_terms` row
   in place — status, the winning code, its full dictionary hierarchy, and a
   `status_changed_by` audit marker distinguishing machine coding from human
   action.

Step Functions owns sequencing, retries, and the audit trail (the execution history
*is* the audit trail — no separate logging needed). The agent owns reasoning within
one bounded step and cannot skip a gate or reorder the workflow. See
`state-machine/coding-workflow.asl.yaml` for the full annotated definition.

## Data model

One Aurora PostgreSQL (Serverless v2) cluster, five tables, accessed entirely through
the RDS Data API (no VPC attachment needed by the Lambdas):

| Table | Role |
|---|---|
| `dictionary_terms` | The target vocabulary (MedDRA LLT/PT or WHODrug trade/generic names), each row carrying its full hierarchy (`JSONB`) and a Titan v2 embedding (`VECTOR(1024)`, HNSW index) of its normalized text. |
| `synonym_list` | Curated verbatim → code shortcuts that widen "exact match" beyond literal dictionary text (e.g. `"Hypothyroid"` → Hypothyroidism / `10021114`). |
| `terms_not_to_autocode` | The safety block-list, checked first — a hit is a deliberate "never auto-assign," not "no match found." |
| `study_terms` | The work queue: one row per verbatim, holding both the input (verbatim, dictionary, version, study) and the coding output (status, code, hierarchy, score) on the same row. |
| `study_metadata` | What each trial is about, in prose — three columns (id, study name, description). Read by `get_study_info` so the agent can break ties between candidate terms. Joined to `study_terms.source_study` by name. |

See `lib/constructs/coding-database.ts` for the CDK-managed cluster and
`scripts/seed.ts` for the schema DDL and sample data loader.

## Repo layout

```
lib/
├── coding-stack.ts                    # top-level CDK stack
└── constructs/
    ├── coding-database.ts            # Aurora Serverless v2 + pgvector
    ├── coding-lambdas.ts             # checkDirect, dictionarySearch, writeBack
    ├── coding-gateway.ts             # AgentCore Gateway fronting the search tool
    ├── coding-harness.ts             # AgentCore Harness resource
    └── coding-state-machine.ts       # Step Functions state machine + role
lambda/
├── checkDirect/                      # State 1 — block-list + exact/synonym match
├── tools/dictionarySearch/           # Gateway tool — pgvector semantic search
├── tools/studyInfo/                  # Gateway tool — study metadata lookup
├── writeBack/                        # State 4 — persist outcome to study_terms
└── shared/dataApi.ts                 # RDS Data API helper
state-machine/
└── coding-workflow.asl.yaml          # the state machine (JSONata)
scripts/
└── seed.ts                           # creates schema, loads data/*.csv, embeds
data/
├── dictionary_terms_meddra.csv       # (1) MedDRA target vocabulary
├── dictionary_terms_whodrug.csv      # (1) WHODrug target vocabulary
├── synonym_list.csv                  # (2) curated verbatim -> code
├── terms_not_to_autocode.csv         # (3) block-list
├── study_terms_input.csv             # (4) input verbatims to code
├── study_metadata.csv                # (5) study context for disambiguation
├── golden_walkthrough.csv            # (6) 9 traced cases A-I (the tests below)
└── generate_sample_data.py           # regenerates every CSV above
```

## Deploy

```bash
npm install
npm run build
npx cdk deploy
```

Note the stack outputs — you'll need them below:

```
MedicalCodingAgentCoreDemo.DbClusterArn = arn:aws:rds:...:cluster:...
MedicalCodingAgentCoreDemo.DbName = coding
MedicalCodingAgentCoreDemo.DbSecretArn = arn:aws:secretsmanager:...
MedicalCodingAgentCoreDemo.StateMachineArn = arn:aws:states:...:stateMachine:MedicalCodingWorkflow
```

## Seed the database

Creates the four tables and loads `data/*.csv`, generating a Titan v2 embedding for
every dictionary row along the way:

```bash
npm run seed
# equivalent to: npx tsx scripts/seed.ts --stack MedicalCodingAgentCoreDemo
```

Re-run any time — it drops and recreates the tables, so it's always safe to reseed
before a test pass. The script prints a row-count verification at the end; if Aurora
had auto-paused, the first call may take ~15-30s to resume (the script retries
automatically).

## The golden walkthrough: testing each routing variation

`data/golden_walkthrough.csv` traces one input verbatim through every branch the
state machine can take. After seeding, `study_terms` has nine `open` rows — one per
case below. Each case starts a Step Functions execution and checks both the
execution output and the persisted database row.

| Case | Verbatim | Path exercised | Expected outcome |
|---|---|---|---|
| A | `Dislocated shoulder` | exact dictionary match | `autocoded`, score 1.00 |
| B | `Hypothyroid` | synonym match | `autocoded`, score 1.00 |
| C | `HAEMORRHAGE` | block-list hit | `open` (safety block) |
| D | `migrane` | agent, high confidence | `autocoded` |
| E | `flutters in my chest sometimes` | agent, medium confidence | `approval_required` |
| F | `asdfghjkl` | agent, no confident match | `open` |
| G | `ibuprofen` | exact match (WHODrug) | `autocoded`, score 1.00 |
| H | `FULVESTRANT` | exact match, `derivation_only` | `autocoded`, only `derivation`/`hierarchy` written, no new `dict_term` |
| I | `nexiuum` | agent, medium confidence (misspelling) | `approval_required` |

### Run one case and check the response

```bash
export STACK=MedicalCodingAgentCoreDemo
export REGION=us-east-1   # or your deploy region

SM_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" --output text)
CLUSTER_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DbClusterArn'].OutputValue" --output text)
SECRET_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DbSecretArn'].OutputValue" --output text)
DB_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DbName'].OutputValue" --output text)

# 1. Look up the record_id for the case you want to run (e.g. case D, "migrane")
aws rds-data execute-statement --region "$REGION" \
  --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DB_NAME" \
  --sql "SELECT record_id, verbatim, encoding_dictionary, encoding_dictionary_version,
                source_study, derivation_only
         FROM study_terms WHERE verbatim = 'migrane'"

# 2. Start an execution with that row's fields as input
aws stepfunctions start-execution --region "$REGION" \
  --state-machine-arn "$SM_ARN" \
  --name "case-D-$(date +%s)" \
  --input '{
    "record_id": "<record_id from step 1>",
    "verbatim": "migrane",
    "encoding_dictionary": "MedDRA",
    "encoding_dictionary_version": "v27.0",
    "source_study": "ONCO-2024-01",
    "derivation_only": false
  }'
# -> returns an executionArn; save it

# 3. Check the response: execution status + output
aws stepfunctions describe-execution --region "$REGION" \
  --execution-arn "<executionArn from step 2>" \
  --query "{status: status, output: output}"

# 4. Check the response: the persisted row (the source of truth)
aws rds-data execute-statement --region "$REGION" \
  --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DB_NAME" \
  --sql "SELECT status, status_changed_by, dict_term, dict_term_code, derivation, match_score
         FROM study_terms WHERE verbatim = 'migrane'"
```

A `SUCCEEDED` execution with a populated `status`/`dict_term_code` in the DB confirms
the case coded as expected. For the block-list and no-match cases (C, F), the
execution still `SUCCEEDED` — an un-coded term is a valid business outcome the
workflow reaches deliberately (via `MarkOpen`), not a failure.

### Run all nine cases at once

Loop over every `open` row seeded from `study_terms_input.csv` and start one
execution per row — this is the fastest way to exercise every branch in one pass:

```bash
RECORDS=$(aws rds-data execute-statement --region "$REGION" \
  --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DB_NAME" \
  --sql "SELECT record_id, verbatim, encoding_dictionary, encoding_dictionary_version,
                source_study, derivation_only
         FROM study_terms WHERE status = 'open' ORDER BY record_id" \
  --query "records" --output json)

echo "$RECORDS" | jq -c '.[] | {
  record_id: .[0].stringValue,
  verbatim: .[1].stringValue,
  encoding_dictionary: .[2].stringValue,
  encoding_dictionary_version: .[3].stringValue,
  source_study: .[4].stringValue,
  derivation_only: .[5].booleanValue
}' | while read -r input; do
  aws stepfunctions start-execution --region "$REGION" \
    --state-machine-arn "$SM_ARN" \
    --name "golden-$(uuidgen)" \
    --input "$input"
done

# Poll until all executions leave RUNNING, then compare against the table above:
aws stepfunctions list-executions --region "$REGION" \
  --state-machine-arn "$SM_ARN" --status-filter RUNNING --query "executions[].name"

# Full result set to diff against the expectations table:
aws rds-data execute-statement --region "$REGION" \
  --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DB_NAME" \
  --sql "SELECT verbatim, status, dict_term_code, match_score, status_changed_by
         FROM study_terms ORDER BY record_id"
```

### Inspecting a failed or unexpected route

If an execution's outcome doesn't match the table, read its history for the state
that made the call:

```bash
aws stepfunctions get-execution-history --region "$REGION" \
  --execution-arn "<executionArn>" \
  --query "events[?type=='TaskSucceeded' || contains(type, 'Failed')].{type: type, id: id}"
```

Two states worth checking directly when a semantic-search case (D, E, F, I) doesn't
land where expected:

- **CodingAgent's raw tool output** — invoke either Gateway tool directly to see
  what the agent sees, without going through the LLM:
  ```bash
  # candidates + cosine scores
  aws lambda invoke --region "$REGION" \
    --function-name coding-demo-tool-dictionary-search \
    --payload '{"verbatim_term":"migrane","dictionary":"MedDRA","dictionary_version":"v27.0","top_k":5}' \
    --cli-binary-format raw-in-base64-out /dev/stdout

  # study context used to break ties
  aws lambda invoke --region "$REGION" \
    --function-name coding-demo-tool-study-info \
    --payload '{"study_name":"ONCO-2024-01"}' \
    --cli-binary-format raw-in-base64-out /dev/stdout
  ```
- **The agent's parsed answer** — in the execution history, the `invokeHarness`
  `TaskSucceeded` event's output contains the assistant's JSON text (term, code,
  hierarchy, and self-reported confidence score) that `ScoreThreshold` routes on.

> **Known calibration gap:** the 0.90/0.70 thresholds above are illustrative and were
> not derived from this sample's actual embeddings. Raw Titan cosine similarity for
> this fixture data does not land in those bands, so cases D, E, and I may currently
> all route to `open` instead of their expected outcome — retrieval correctness (the
> right candidate is always found) and score calibration (the number used for
> routing) are separate concerns, and only the former is guaranteed by the current
> prompt. See `docs/DISCLAIMER.md`.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
