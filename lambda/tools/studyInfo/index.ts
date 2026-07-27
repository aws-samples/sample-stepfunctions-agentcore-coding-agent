import { executeStatement } from '../../shared/dataApi';

/**
 * Gateway tool `get_study_info`. Given a study name, returns that study's
 * name and its free-text metadata description from the study_metadata
 * table.
 *
 * Why the agent needs this: similarity search over the dictionary can return
 * several clinically plausible candidates that it cannot separate on text
 * alone - the embedding only knows what the words look like, not what the
 * trial is about. A human coder breaks that tie with study context ("this is
 * a breast-cancer study monitoring cardiac rhythm events, so the cardiac
 * term is the likely reading"). This tool supplies that same context so the
 * agent can choose the best term FROM THE CANDIDATES search_dictionary
 * already returned.
 *
 * Deliberately narrow: one keyed lookup, no embedding, no Bedrock call. It
 * returns context for choosing, never codes to choose from - the study
 * description must never become a source of dictionary codes (see the
 * SystemPrompt constraints in state-machine/coding-workflow.asl.yaml, and
 * the candidate-membership check in lambda/writeBack).
 *
 * An unknown study returns `{ found: false }` rather than throwing, so a
 * missing metadata row degrades to "no extra context" instead of failing the
 * agent's turn (and, in turn, the whole coding execution).
 */

interface StudyInfoInput {
  study_name: string;
}

interface StudyInfoResult {
  found: boolean;
  study_name?: string;
  study_description?: string;
}

export const handler = async (event: StudyInfoInput): Promise<StudyInfoResult> => {
  const studyName = event.study_name?.trim();
  if (!studyName) {
    throw new Error('get_study_info requires a non-empty "study_name".');
  }

  const rows = await executeStatement(
    `SELECT study_name, study_description
     FROM study_metadata
     WHERE lower(study_name) = lower(:study_name)
     LIMIT 1`,
    [{ name: 'study_name', value: { stringValue: studyName } }]
  );

  if (rows.length === 0) {
    return { found: false };
  }

  return {
    found: true,
    study_name: rows[0].study_name as string,
    study_description: rows[0].study_description as string,
  };
};
