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
  /**
   * The dictionary and version the term is coded against. When present, the
   * selected code is verified to exist in that dictionary before it is
   * persisted (see verifyCodeExists).
   */
  encoding_dictionary?: string | null;
  encoding_dictionary_version?: string | null;
  /**
   * Set only when a Catch routed the execution here after an error. Null on
   * the deliberate open paths (block-list hit, confidence below the review
   * floor). Recorded so an operator can tell "we chose not to code this" from
   * "something broke" - both otherwise look identical in study_terms.
   */
  failure_reason?: string | null;
}

interface WriteBackResult {
  record_id: string;
  status: string;
  dict_term_code?: string | null;
  score?: number | null;
  /** Present only when the row was left open because something failed. */
  failure_reason?: string | null;
}

export const handler = async (event: WriteBackInput): Promise<WriteBackResult> => {
  const recordId = event.record_id;
  const target = event.target_status;
  if (!recordId || !target) {
    throw new Error('WriteBack requires "record_id" and "target_status".');
  }

  if (target === 'open') {
    await markOpen(recordId, event.failure_reason ?? null);
    return {
      record_id: recordId,
      status: 'open',
      ...(event.failure_reason ? { failure_reason: event.failure_reason } : {}),
    };
  }

  const cand = event.candidate ?? null;
  if (cand === null || Object.keys(cand).length === 0) {
    // Defensive: asked to code, but handed no candidate. That is a caller
    // bug, not a coding decision, so record it as such rather than letting it
    // masquerade as "deliberately left open".
    await markOpen(recordId, 'MissingCandidate');
    return { record_id: recordId, status: 'open', failure_reason: 'MissingCandidate' };
  }

  if (typeof cand.dict_term_code !== 'string' || cand.dict_term_code.length === 0) {
    throw new Error(
      `WriteBack(${target}) candidate is missing a valid "dict_term_code" - the model may ` +
        `not have relayed real search_dictionary output. Candidate: ${JSON.stringify(cand)}`
    );
  }

  // Fabrication guard: the chosen code must actually exist in the dictionary
  // being coded against. Prompt text is guidance; this is the gate. It
  // matters more now that the agent also reads study metadata - free-text
  // context is exactly the kind of input that invites plausible invention,
  // e.g. copying a code out of a study description.
  //
  // Note this checks existence, not candidate membership: invokeHarness
  // returns only the model's final message, not its tool results, so the
  // workflow cannot know which codes search_dictionary actually returned. A
  // code that exists in the right dictionary and version is the strongest
  // check available on this side of the boundary.
  if (event.encoding_dictionary && event.encoding_dictionary_version) {
    await verifyCodeExists(
      cand.dict_term_code,
      event.encoding_dictionary,
      event.encoding_dictionary_version
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

/**
 * Throws unless the code exists in the given dictionary + version as a
 * non-prior-index entry. The state's Catch turns that into MarkOpen, so a
 * fabricated code leaves the record safely open with the reason in the
 * execution history.
 */
const verifyCodeExists = async (
  code: string,
  dictionary: string,
  version: string
): Promise<void> => {
  const rows = await executeStatement(
    `SELECT 1 AS hit
     FROM dictionary_terms
     WHERE dictionary = :dictionary
       AND dictionary_version = :version
       AND dict_term_code = :code
       AND is_prior_index = FALSE
     LIMIT 1`,
    [
      { name: 'dictionary', value: { stringValue: dictionary } },
      { name: 'version', value: { stringValue: version } },
      { name: 'code', value: { stringValue: code } },
    ]
  );
  if (rows.length === 0) {
    throw new Error(
      `WriteBack refused code ${code}: not found in ${dictionary} ${version} ` +
        `(the model may have invented it or taken it from non-dictionary context).`
    );
  }
};

const markOpen = async (recordId: string, failureReason: string | null): Promise<void> => {
  // status_changed_by carries the failure cause when there was one, so the
  // distinction survives in the row itself and not only in the execution
  // history: 'autocoding-workflow' = decided not to code,
  // 'autocoding-workflow:error:<Error>' = never got to decide.
  const changedBy = failureReason ? `${MACHINE}:error:${failureReason}` : MACHINE;
  await executeStatement(
    `UPDATE study_terms
     SET status = 'open', status_changed_by = :by,
         last_encoded_ts = EXTRACT(EPOCH FROM now())
     WHERE record_id = :record_id`,
    [
      { name: 'record_id', value: { stringValue: recordId } },
      { name: 'by', value: { stringValue: changedBy } },
    ]
  );
};

const stringOrNull = (name: string, value: string | null | undefined) => ({
  name,
  value: value == null ? { isNull: true } : { stringValue: value },
});
