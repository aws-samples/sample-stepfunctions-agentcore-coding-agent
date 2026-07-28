import { handler } from '../lambda/checkDirect/index';
import * as dataApi from '../lambda/shared/dataApi';

/**
 * Unit tests for the deterministic direct-lookup state (state 1).
 *
 * This is the branch that decides whether a verbatim is coded WITHOUT any
 * model call, blocked outright, or escalated to the agent. Its tri-state
 * return value is the contract the ASL `RouteDirect` Choice state routes on,
 * so a regression here silently changes which terms reach the LLM (and what
 * gets billed). The RDS Data API layer is mocked - these tests pin the
 * decision logic, not SQL.
 */

jest.mock('../lambda/shared/dataApi');
const mockExecute = dataApi.executeStatement as jest.MockedFunction<
  typeof dataApi.executeStatement
>;

const HIERARCHY = JSON.stringify([{ pt: 'Migraine', pt_code: '10027599' }]);

const input = {
  verbatim: 'Hypothyroid',
  encoding_dictionary: 'MedDRA',
  encoding_dictionary_version: 'v27.0',
};

const dictRow = (code: string, matchType: 'exact' | 'synonym' = 'exact') => ({
  dict_term: 'Hypothyroidism',
  dict_term_type: 'PT',
  dict_term_code: code,
  derivation: 'Hypothyroidism',
  hierarchy: HIERARCHY,
  match_type: matchType,
});

beforeEach(() => {
  mockExecute.mockReset();
});

describe('checkDirect', () => {
  it('blocks a block-list hit before attempting any match', async () => {
    // First call is the block-list guard; a hit must short-circuit.
    mockExecute.mockResolvedValueOnce([{ hit: 1 }]);

    const result = await handler({ ...input, verbatim: 'HAEMORRHAGE' });

    expect(result).toEqual({
      blocked: true,
      matched: false,
      match_type: null,
      candidate: null,
    });
    // Critically: the match query must NOT have run.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('autocodes a unique exact/synonym match at score 1.0', async () => {
    mockExecute
      .mockResolvedValueOnce([]) // block-list: no hit
      .mockResolvedValueOnce([dictRow('10021114', 'synonym')]);

    const result = await handler(input);

    expect(result.blocked).toBe(false);
    expect(result.matched).toBe(true);
    expect(result.match_type).toBe('synonym');
    expect(result.candidate?.dict_term_code).toBe('10021114');
    expect(result.candidate?.score).toBe(1.0);
    // JSONB arrives as text over the Data API and must be parsed to JSON.
    expect(result.candidate?.hierarchy).toEqual([
      { pt: 'Migraine', pt_code: '10027599' },
    ]);
  });

  it('escalates to the agent when no match is found', async () => {
    mockExecute
      .mockResolvedValueOnce([]) // block-list
      .mockResolvedValueOnce([]); // no dictionary/synonym hit

    const result = await handler({ ...input, verbatim: 'migrane' });

    expect(result).toEqual({
      blocked: false,
      matched: false,
      match_type: null,
      candidate: null,
    });
  });

  it('escalates when the verbatim maps to two DIFFERENT codes', async () => {
    // Ambiguity the deterministic path must not resolve on its own.
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([dictRow('10021114'), dictRow('10020850')]);

    const result = await handler(input);

    expect(result.matched).toBe(false);
    expect(result.candidate).toBeNull();
  });

  it('still autocodes when duplicate rows share ONE code', async () => {
    // Same code from both the synonym list and the dictionary is not
    // ambiguity - it is agreement, and must remain a deterministic hit.
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        dictRow('10021114', 'synonym'),
        dictRow('10021114', 'exact'),
      ]);

    const result = await handler(input);

    expect(result.matched).toBe(true);
    expect(result.candidate?.dict_term_code).toBe('10021114');
  });

  it('rejects incomplete input rather than silently coding it', async () => {
    await expect(
      handler({ ...input, verbatim: '   ' })
    ).rejects.toThrow(/non-empty/);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('tolerates a null/unparseable hierarchy', async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...dictRow('10021114'), hierarchy: 'not-json' }]);

    const result = await handler(input);

    expect(result.matched).toBe(true);
    expect(result.candidate?.hierarchy).toBeNull();
  });
});
