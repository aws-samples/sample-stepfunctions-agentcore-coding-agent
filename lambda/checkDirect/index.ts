import { executeStatement, Row } from '../shared/dataApi';

/**
 * First state in the coding workflow: the deterministic direct-lookup path,
 * run before any LLM involvement. Combines the block-list guard and the
 * exact/synonym match into one Lambda. Given a verbatim term it checks, in
 * order:
 *
 *   1. The terms-not-to-autocode block-list. A hit is a deliberate safety
 *      block: the term is too ambiguous to auto-assign (e.g. "HAEMORRHAGE")
 *      and must be left open for a human coder. This runs BEFORE any match
 *      attempt, so even a real dictionary term is still blocked.
 *   2. Case-insensitive exact match against BOTH the dictionary_terms table
 *      and the synonym_list table (active synonyms only). A match is
 *      accepted only if it is UNIQUE - exactly one distinct dict_term_code.
 *      This is where the synonym list earns its keep: a curated synonym row
 *      lets a non-obvious verbatim (e.g. "Hypothyroid") exact-match a real
 *      code (Hypothyroidism / 10021114).
 *
 * No LLM, no embeddings - just indexed string comparisons. The bulk of
 * clinical verbatims code here, cheaply and reproducibly, before any agent
 * is invoked.
 *
 * Returns a tri-state result the ASL Choice routes on:
 *   blocked=true              -> MarkOpen (safety block, not "no match")
 *   matched=true + candidate  -> WriteBack (deterministic autocode, score 1.0)
 *   neither                   -> CodingAgent (vector-search-assisted coding)
 */

interface CheckDirectInput {
  verbatim: string;
  encoding_dictionary: string;
  encoding_dictionary_version: string;
}

export interface Candidate {
  dict_term: string | null;
  dict_term_type: string | null;
  dict_term_code: string | null;
  derivation: string | null;
  hierarchy: unknown;
  score: number;
}

interface CheckDirectResult {
  blocked: boolean;
  matched: boolean;
  match_type: 'synonym' | 'exact' | null;
  candidate: Candidate | null;
}

export const handler = async (event: CheckDirectInput): Promise<CheckDirectResult> => {
  const verbatim = event.verbatim?.trim();
  const dictionary = event.encoding_dictionary;
  const version = event.encoding_dictionary_version;
  if (!verbatim || !dictionary || !version) {
    throw new Error(
      'CheckDirect requires non-empty "verbatim", "encoding_dictionary" and ' +
        '"encoding_dictionary_version" in the execution input.'
    );
  }

  // 1) Block-list guard.
  const blocked = await executeStatement(
    `SELECT 1 AS hit
     FROM terms_not_to_autocode
     WHERE dictionary = :dictionary
       AND lower(verbatim) = lower(:verbatim)
       AND status = 'active'
     LIMIT 1`,
    [
      { name: 'dictionary', value: { stringValue: dictionary } },
      { name: 'verbatim', value: { stringValue: verbatim } },
    ]
  );
  if (blocked.length > 0) {
    return { blocked: true, matched: false, match_type: null, candidate: null };
  }

  // 2) Exact + synonym match.
  const rows = await executeStatement(
    `-- curated synonyms (active) that pin a verbatim to a real code
     SELECT dict_term, dict_term_type, dict_term_code, derivation,
            hierarchy::text AS hierarchy, 'synonym' AS match_type
     FROM synonym_list
     WHERE dictionary = :dictionary
       AND status = 'active'
       AND lower(verbatim) = lower(:verbatim)
     UNION
     -- direct dictionary hits (exclude prior-index rows)
     SELECT dict_term, dict_term_type, dict_term_code, derivation,
            hierarchy::text AS hierarchy, 'exact' AS match_type
     FROM dictionary_terms
     WHERE dictionary = :dictionary
       AND dictionary_version = :version
       AND is_prior_index = FALSE
       AND lower(verbatim_text) = lower(:verbatim)`,
    [
      { name: 'dictionary', value: { stringValue: dictionary } },
      { name: 'version', value: { stringValue: version } },
      { name: 'verbatim', value: { stringValue: verbatim } },
    ]
  );

  // Accept only a unique distinct code - two different codes for the same
  // verbatim means the deterministic path cannot decide.
  const distinctCodes = new Set(rows.map((r) => r.dict_term_code));
  if (distinctCodes.size === 1) {
    const best = rows[0];
    return {
      blocked: false,
      matched: true,
      match_type: best.match_type as 'synonym' | 'exact',
      candidate: {
        dict_term: best.dict_term as string,
        dict_term_type: best.dict_term_type as string | null,
        dict_term_code: best.dict_term_code as string,
        derivation: best.derivation as string | null,
        hierarchy: parseHierarchy(best),
        score: 1.0,
      },
    };
  }

  return { blocked: false, matched: false, match_type: null, candidate: null };
};

/** JSONB columns travel through the Data API as text - normalize to JSON. */
const parseHierarchy = (row: Row): unknown => {
  if (typeof row.hierarchy !== 'string') return null;
  try {
    return JSON.parse(row.hierarchy);
  } catch {
    return null;
  }
};
