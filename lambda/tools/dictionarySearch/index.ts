import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { executeStatement } from '../../shared/dataApi';

/**
 * Gateway tool `search_dictionary`, called by the CodingAgent when the
 * deterministic direct-lookup path missed. Ported from the blog's
 * vector_search @tool (agent_app.py): embeds the verbatim term with Titan
 * Text Embeddings v2 and runs a pgvector cosine-distance (<=>) similarity
 * query against the dictionary_terms table, scoped to the requested
 * dictionary + version and excluding prior-index rows. Vectors live
 * alongside the source rows - see lib/constructs/coding-database.ts.
 *
 * Returns the top-k candidate dictionary entries, each with the full code
 * hierarchy and a 0-1 similarity `score` (1.0 = identical) for the agent to
 * choose from. The agent copies the winning candidate's fields verbatim into
 * its JSON answer; the workflow's Choice state then routes on `score`.
 *
 * Embeddings are written by the seed script for now (scripts/seed.py); the
 * CDC-driven embedding pipeline is deferred. Rows without an embedding are
 * excluded rather than erroring so a partially-embedded table degrades
 * gracefully.
 */

const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 25;

const bedrock = new BedrockRuntimeClient({});

interface DictionarySearchInput {
  verbatim_term: string;
  dictionary: string;
  dictionary_version: string;
  top_k?: number;
}

export const handler = async (event: DictionarySearchInput) => {
  const term = event.verbatim_term?.trim();
  const dictionary = event.dictionary?.trim();
  const version = event.dictionary_version?.trim();
  if (!term || !dictionary || !version) {
    throw new Error(
      'search_dictionary requires non-empty "verbatim_term", "dictionary" and "dictionary_version".'
    );
  }
  const topK = Math.min(Math.max(Math.trunc(event.top_k ?? DEFAULT_TOP_K), 1), MAX_TOP_K);

  const embedding = await embed(term);

  // The Data API has no native vector type; the embedding travels as its
  // pgvector text representation ('[0.1,0.2,...]') and is cast server-side.
  // Likewise the JSONB hierarchy comes back as text and is parsed below.
  const rows = await executeStatement(
    `SELECT dict_term, dict_term_type, dict_term_code, derivation,
            hierarchy::text AS hierarchy,
            round((1 - (verbatim_text_embedding <=> :query_embedding::vector))::numeric, 4)::float8 AS score
     FROM dictionary_terms
     WHERE dictionary = :dictionary
       AND dictionary_version = :version
       AND is_prior_index = FALSE
       AND verbatim_text_embedding IS NOT NULL
     ORDER BY verbatim_text_embedding <=> :query_embedding::vector
     LIMIT :top_k`,
    [
      { name: 'query_embedding', value: { stringValue: `[${embedding.join(',')}]` } },
      { name: 'dictionary', value: { stringValue: dictionary } },
      { name: 'version', value: { stringValue: version } },
      { name: 'top_k', value: { longValue: topK } },
    ]
  );

  const matches = rows.map((row) => ({
    ...row,
    hierarchy: safeParse(row.hierarchy),
  }));

  return { matches };
};

const safeParse = (value: unknown): unknown => {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const embed = async (text: string): Promise<number[]> => {
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
        dimensions: EMBEDDING_DIMENSIONS,
        normalize: true,
      }),
    })
  );
  const payload = JSON.parse(new TextDecoder().decode(response.body));
  if (!Array.isArray(payload.embedding)) {
    throw new Error('Titan embedding response did not contain an "embedding" array.');
  }
  return payload.embedding;
};
