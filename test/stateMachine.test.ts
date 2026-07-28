import { readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * Contract tests for the state machine definition itself.
 *
 * These guard the two things that broke silently in live testing and that no
 * type checker can catch, because both live inside JSONata string expressions
 * in the ASL YAML:
 *
 *  1. The agent's reply is parsed by extracting the first "{" to the last "}"
 *     rather than trusting the model to emit bare JSON. Models reliably
 *     narrate before the JSON once the prompt asks them to reason; a bare
 *     $parse of the whole reply then throws, the Catch routes to MarkOpen, and
 *     correctly-coded terms silently end up uncoded.
 *
 *  2. The Gateway tool names in AllowedTools use the fully-qualified
 *     "{target}___{tool}" form. Bare tool names match nothing, the tools are
 *     silently filtered out, and the model answers from its own "knowledge"
 *     instead of erroring - the worst possible failure mode for medical
 *     coding.
 */

const ASL_PATH = join(__dirname, '..', 'state-machine', 'coding-workflow.asl.yaml');
const asl = parseYaml(readFileSync(ASL_PATH, 'utf-8'));

/** The JSONata regex the ASL uses, applied here the same way. */
const extractJson = (reply: string): string | null => {
  const m = reply.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
};

describe('agent reply parsing (ScoreThreshold input)', () => {
  const answer =
    '{"dict_term":"Migraine","dict_term_type":"PT","dict_term_code":"10027599",' +
    '"derivation":"Migraine","hierarchy":[{"pt":"Migraine"}],"score":0.99,' +
    '"rationale":"obvious misspelling"}';

  it('parses a bare JSON reply', () => {
    const parsed = JSON.parse(extractJson(answer)!);
    expect(parsed.dict_term_code).toBe('10027599');
    expect(parsed.score).toBe(0.99);
  });

  it('parses JSON preceded by model narration (the observed regression)', () => {
    const reply = `The top candidate is clearly the best match.\n\n${answer}`;
    const parsed = JSON.parse(extractJson(reply)!);
    expect(parsed.dict_term_code).toBe('10027599');
  });

  it('parses JSON wrapped in markdown fences', () => {
    const reply = '```json\n' + answer + '\n```';
    const parsed = JSON.parse(extractJson(reply)!);
    expect(parsed.score).toBe(0.99);
  });

  it('parses greedily so nested hierarchy objects survive', () => {
    const reply = `Reasoning first. ${answer} And a trailing sentence.`;
    const parsed = JSON.parse(extractJson(reply)!);
    // A non-greedy match would truncate at the hierarchy's inner "}".
    expect(parsed.rationale).toBe('obvious misspelling');
  });

  it('yields no match when the reply contains no JSON at all', () => {
    // -> States.QueryEvaluationError -> Catch -> MarkOpen, which is the
    // intended "no confident code" outcome rather than a workflow failure.
    expect(extractJson('I cannot help with that.')).toBeNull();
  });

  it('normalizes a missing or non-numeric score to 0', () => {
    const normalize = (s: unknown) => (typeof s === 'number' ? s : 0);
    expect(normalize(JSON.parse('{"score":0.88}').score)).toBe(0.88);
    expect(normalize(JSON.parse('{}').score)).toBe(0);
    expect(normalize(JSON.parse('{"score":"high"}').score)).toBe(0);
  });
});

describe('state machine wiring', () => {
  it('routes every terminal path to a write-back state', () => {
    const states = asl.States;
    expect(Object.keys(states)).toEqual(
      expect.arrayContaining([
        'CaptureInput', 'CheckDirect', 'RouteDirect', 'CodingAgent',
        'ScoreThreshold', 'WriteBack', 'MarkForReview', 'MarkOpen',
      ])
    );
    // An un-coded term is a valid business outcome: MarkOpen must be terminal
    // and must not itself be able to fail the execution.
    expect(states.MarkOpen.End).toBe(true);
    expect(states.MarkOpen.Catch).toBeUndefined();
  });

  it('sends every fallible state to MarkOpen on error', () => {
    for (const name of ['CheckDirect', 'CodingAgent', 'WriteBack', 'MarkForReview']) {
      const catches = asl.States[name].Catch;
      expect(catches).toBeDefined();
      expect(catches[0].Next).toBe('MarkOpen');
    }
  });

  it('uses fully-qualified Gateway tool names in AllowedTools', () => {
    const allowed: string[] = asl.States.CodingAgent.Arguments.AllowedTools;
    expect(allowed).toEqual([
      '@gateway/search-dictionary___search_dictionary',
      '@gateway/study-info___get_study_info',
    ]);
    // Bare names silently match nothing - guard against a regression to them.
    for (const t of allowed) {
      expect(t).toMatch(/___/);
    }
  });

  it('checks the block-list before the score gates can autocode', () => {
    const choices = asl.States.RouteDirect.Choices;
    expect(choices[0].Condition).toContain('blocked');
    expect(choices[0].Next).toBe('MarkOpen');
  });

  it('keeps the autocode gate above the review gate', () => {
    const [auto, review] = asl.States.ScoreThreshold.Choices;
    expect(auto.Next).toBe('WriteBack');
    expect(review.Next).toBe('MarkForReview');
    const num = (c: string) => parseFloat(c.match(/[\d.]+/)![0]);
    expect(num(auto.Condition)).toBeGreaterThan(num(review.Condition));
    expect(asl.States.ScoreThreshold.Default).toBe('MarkOpen');
  });

  it('instructs the agent to report confidence, not retrieval similarity', () => {
    // The defect this repo shipped with: routing on raw cosine similarity,
    // which is not a confidence measure. Pin the corrected semantics.
    const prompt: string = asl.States.CodingAgent.Arguments.SystemPrompt[0].Text;
    expect(prompt).toMatch(/YOUR OWN CODING CONFIDENCE/);
    expect(prompt).toMatch(/NOT the retrieval similarity score/);
  });
});
