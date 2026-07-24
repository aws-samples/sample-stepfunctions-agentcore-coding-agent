import { executeStatement } from '../shared/dataApi';

/**
 * Terminal state for the coding workflow. Persists the coding outcome onto
 * the SAME study_terms row (in place). Handles three target states:
 *
 *   - autocoded          : deterministic (exact/synonym) OR high-confidence agent
 *   - approval_required  : medium-confidence agent candidate -> human queue
 *   - open               : blocked / no confident match -> manual coding
 *
 * derivation_only mode (WHODrug + from_source=EDC): on an exact 1:1 match,
 * only derivation + hierarchy are written; no new dict_term is assigned.
 *
 * status_changed_by is set to the machine identity ("autocoding-workflow")
 * so a coded record is always distinguishable from one a human touched.
 *
 * The winning candidate is selected by the ASL (deterministic match first,
 * else the agent's answer - see state-machine/coding-workflow.asl.yaml).
 * This Lambda also absorbs the old finalize validation: a non-open write
 * whose candidate lacks a dict_term_code is rejected loudly, since output
 * validation is the only signal that the model relayed real
 * search_dictionary results instead of fabricating codes. The state's
 * Catch routes that failure to MarkOpen, so the record safely stays open.
 */

const MACHINE = 'autocoding-workflow';

interface Candidate {
  dict_term?: string | null;
  dict_term_type?: string | null;
  dict_term_code?: string | null;
  derivation?: string | null;
  hierarchy?: unknown;
  score?: number | null;
}

interface WriteBackInput {
  record_id: string;
  target_status: 'autocoded' | 'approval_required' | 'open';
  candidate?: Candidate | null;
  derivation_only?: boolean;
}

interface WriteBackResult {
  record_id: string;
  status: string;
  dict_term_code?: string | null;
  score?: number | null;
}

export const handler = async (event: WriteBackInput): Promise<WriteBackResult> => {
  const recordId = event.record_id;
  const target = event.target_status;
  if (!recordId || !target) {
    throw new Error('WriteBack requires "record_id" and "target_status".');
  }

  if (target === 'open') {
    await markOpen(recordId);
    return { record_id: recordId, status: 'open' };
  }

  const cand = event.candidate ?? null;
  if (cand === null || Object.keys(cand).length === 0) {
    // defensive: nothing to write -> fall back to open
    await markOpen(recordId);
    return { record_id: recordId, status: 'open' };
  }

  if (typeof cand.dict_term_code !== 'string' || cand.dict_term_code.length === 0) {
    throw new Error(
      `WriteBack(${target}) candidate is missing a valid "dict_term_code" - the model may ` +
        `not have relayed real search_dictionary output. Candidate: ${JSON.stringify(cand)}`
    );
  }

  const scoreParam =
    typeof cand.score === 'number'
      ? { name: 'score', value: { doubleValue: cand.score } }
      : { name: 'score', value: { isNull: true } };
  const hierarchyParam = {
    name: 'hierarchy',
    value:
      cand.hierarchy == null
        ? { isNull: true }
        : { stringValue: JSON.stringify(cand.hierarchy) },
  };

  if (event.derivation_only) {
    // exact 1:1 only: update derivation + hierarchy, never a new dict_term
    await executeStatement(
      `UPDATE study_terms
       SET status = :status, status_changed_by = :by,
           derivation = :derivation, hierarchy = :hierarchy::jsonb,
           match_score = :score, last_encoded_ts = EXTRACT(EPOCH FROM now())
       WHERE record_id = :record_id`,
      [
        { name: 'record_id', value: { stringValue: recordId } },
        { name: 'status', value: { stringValue: target } },
        { name: 'by', value: { stringValue: MACHINE } },
        stringOrNull('derivation', cand.derivation),
        hierarchyParam,
        scoreParam,
      ]
    );
  } else {
    await executeStatement(
      `UPDATE study_terms
       SET status = :status, status_changed_by = :by,
           dict_term = :dict_term, dict_term_type = :dict_term_type,
           dict_term_code = :dict_term_code, derivation = :derivation,
           hierarchy = :hierarchy::jsonb, match_score = :score,
           last_encoded_ts = EXTRACT(EPOCH FROM now())
       WHERE record_id = :record_id`,
      [
        { name: 'record_id', value: { stringValue: recordId } },
        { name: 'status', value: { stringValue: target } },
        { name: 'by', value: { stringValue: MACHINE } },
        stringOrNull('dict_term', cand.dict_term),
        stringOrNull('dict_term_type', cand.dict_term_type),
        { name: 'dict_term_code', value: { stringValue: cand.dict_term_code } },
        stringOrNull('derivation', cand.derivation),
        hierarchyParam,
        scoreParam,
      ]
    );
  }

  return {
    record_id: recordId,
    status: target,
    dict_term_code: cand.dict_term_code,
    score: cand.score ?? null,
  };
};

const markOpen = async (recordId: string): Promise<void> => {
  await executeStatement(
    `UPDATE study_terms
     SET status = 'open', status_changed_by = :by,
         last_encoded_ts = EXTRACT(EPOCH FROM now())
     WHERE record_id = :record_id`,
    [
      { name: 'record_id', value: { stringValue: recordId } },
      { name: 'by', value: { stringValue: MACHINE } },
    ]
  );
};

const stringOrNull = (name: string, value: string | null | undefined) => ({
  name,
  value: value == null ? { isNull: true } : { stringValue: value },
});
