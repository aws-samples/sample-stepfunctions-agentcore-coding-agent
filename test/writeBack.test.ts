import { handler } from '../lambda/writeBack/index';
import * as dataApi from '../lambda/shared/dataApi';

/**
 * Unit tests for the terminal write-back state (state 4).
 *
 * Covers the fabrication guard (a candidate must carry a real
 * dict_term_code that exists in the target dictionary before it is
 * persisted) and the rationale field: the agent's one-sentence
 * justification must round-trip onto the study_terms row for an agent
 * candidate, and must persist as null for a deterministic candidate (the
 * block-list / exact-match path never produces one). The RDS Data API layer
 * is mocked - these tests pin the write-back logic and its SQL parameters,
 * not a live database.
 */

jest.mock('../lambda/shared/dataApi');
const mockExecute = dataApi.executeStatement as jest.MockedFunction<
  typeof dataApi.executeStatement
>;

beforeEach(() => {
  mockExecute.mockReset();
  process.env.DB_CLUSTER_ARN = 'arn:aws:rds:us-east-1:111111111111:cluster:test';
  process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:111111111111:secret:test';
  process.env.DB_NAME = 'coding';
});

/** Pulls a named bound parameter's value out of an executeStatement call. */
const paramValue = (call: unknown[], name: string): unknown => {
  const params = call[1] as { name: string; value: Record<string, unknown> }[];
  const p = params.find((x) => x.name === name);
  return p?.value;
};

describe('writeBack', () => {
  it('persists an agent candidate\'s rationale onto study_terms', async () => {
    // verifyCodeExists lookup, then the UPDATE.
    mockExecute.mockResolvedValueOnce([{ hit: 1 }]).mockResolvedValueOnce([]);

    const result = await handler({
      record_id: 'GI-2025-03;CM;nexiuum',
      target_status: 'autocoded',
      candidate: {
        dict_term: 'NEXIUM',
        dict_term_type: 'trade name',
        dict_term_code: '00201501382',
        derivation: 'ESOMEPRAZOLE',
        hierarchy: null,
        score: 0.98,
        rationale:
          'The study expects PPIs and explicitly not antifibrinolytics, so NEXIUM (not NEXIM) is the unambiguous read.',
      },
      encoding_dictionary: 'WHODrug',
      encoding_dictionary_version: 'GLOBAL-2024',
    });

    expect(result.rationale).toBe(
      'The study expects PPIs and explicitly not antifibrinolytics, so NEXIUM (not NEXIM) is the unambiguous read.'
    );

    // Second call is the UPDATE; confirm the bound :rationale parameter
    // carries the same string through to SQL, not just the return value.
    const updateCall = mockExecute.mock.calls[1];
    expect(updateCall[0]).toMatch(/rationale\s*=\s*:rationale/);
    expect(paramValue(updateCall, 'rationale')).toEqual({
      stringValue:
        'The study expects PPIs and explicitly not antifibrinolytics, so NEXIUM (not NEXIM) is the unambiguous read.',
    });
  });

  it('persists rationale as null for a deterministic candidate', async () => {
    // Deterministic (CheckDirect) candidates never carry a rationale.
    mockExecute.mockResolvedValueOnce([{ hit: 1 }]).mockResolvedValueOnce([]);

    await handler({
      record_id: 'ONCO-2024-01;AE;hypothyroid',
      target_status: 'autocoded',
      candidate: {
        dict_term: 'Hypothyroidism',
        dict_term_type: 'PT',
        dict_term_code: '10021114',
        derivation: 'Hypothyroidism',
        hierarchy: null,
        score: 1.0,
        // rationale intentionally absent, as CheckDirect's Candidate never
        // sets one.
      },
      encoding_dictionary: 'MedDRA',
      encoding_dictionary_version: 'v27.0',
    });

    const updateCall = mockExecute.mock.calls[1];
    expect(paramValue(updateCall, 'rationale')).toEqual({ isNull: true });
  });

  it('persists rationale as null on the derivation-only branch too', async () => {
    mockExecute.mockResolvedValueOnce([{ hit: 1 }]).mockResolvedValueOnce([]);

    await handler({
      record_id: 'GI-2025-03;CM;ibuprofen',
      target_status: 'autocoded',
      derivation_only: true,
      candidate: {
        dict_term_code: '00200100259',
        derivation: 'IBUPROFEN',
        hierarchy: null,
        score: 1.0,
      },
      encoding_dictionary: 'WHODrug',
      encoding_dictionary_version: 'GLOBAL-2024',
    });

    const updateCall = mockExecute.mock.calls[1];
    expect(updateCall[0]).toMatch(/rationale\s*=\s*:rationale/);
    expect(paramValue(updateCall, 'rationale')).toEqual({ isNull: true });
  });

  it('rejects a candidate missing a dict_term_code (fabrication guard)', async () => {
    await expect(
      handler({
        record_id: 'GI-2025-03;CM;asdfghjkl',
        target_status: 'approval_required',
        candidate: {
          dict_term: null,
          dict_term_code: '',
          score: 0.4,
          rationale: 'No candidate is a credible clinical match.',
        },
      })
    ).rejects.toThrow(/missing a valid "dict_term_code"/);

    // The guard must fire before any UPDATE is attempted.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects a code that does not exist in the target dictionary/version', async () => {
    // verifyCodeExists finds no row.
    mockExecute.mockResolvedValueOnce([]);

    await expect(
      handler({
        record_id: 'GI-2025-03;CM;nexiuum',
        target_status: 'autocoded',
        candidate: {
          dict_term_code: '99999999999',
          score: 0.98,
          rationale: 'Fabricated code should never reach the row.',
        },
        encoding_dictionary: 'WHODrug',
        encoding_dictionary_version: 'GLOBAL-2024',
      })
    ).rejects.toThrow(/WriteBack refused code/);

    // Only the existence check ran; no UPDATE followed a failed guard.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('marks the record open and records the failure_reason', async () => {
    mockExecute.mockResolvedValueOnce([]);

    const result = await handler({
      record_id: 'ONCO-2024-01;AE;haemorrhage',
      target_status: 'open',
      failure_reason: null,
    });

    expect(result).toEqual({
      record_id: 'ONCO-2024-01;AE;haemorrhage',
      status: 'open',
      rationale: null,
    });
  });

  it('keeps the agent rationale on a low-confidence open row', async () => {
    // The audit case that matters most: no code is stored, so the rationale
    // is the only record of WHY the term was left for a human.
    mockExecute.mockResolvedValueOnce([]);

    const why =
      "None of the returned candidates represent an abdominal cramping term, so confidence is reduced because the musculoskeletal SOC conflicts with this GI study's context.";

    const result = await handler({
      record_id: 'GI-2025-03;AE;cramps',
      target_status: 'open',
      failure_reason: null,
      rationale: why,
    });

    expect(result.rationale).toBe(why);

    const call = mockExecute.mock.calls[0];
    expect(call[0]).toMatch(/rationale\s*=\s*:rationale/);
    // Still an open row with no code written.
    expect(call[0]).toMatch(/status\s*=\s*'open'/);
    expect(call[0]).not.toMatch(/dict_term_code\s*=/);
    expect(paramValue(call, 'rationale')).toEqual({ stringValue: why });
  });

  it('records rationale as null when no agent ran (block-list hit)', async () => {
    mockExecute.mockResolvedValueOnce([]);

    await handler({
      record_id: 'ONCO-2024-01;AE;haemorrhage',
      target_status: 'open',
      failure_reason: null,
    });

    const call = mockExecute.mock.calls[0];
    expect(paramValue(call, 'rationale')).toEqual({ isNull: true });
    // Deliberate block, not a failure - status_changed_by stays unqualified.
    expect(paramValue(call, 'by')).toEqual({ stringValue: 'autocoding-workflow' });
  });

  it('still distinguishes an error-path open row from a deliberate one', async () => {
    mockExecute.mockResolvedValueOnce([]);

    await handler({
      record_id: 'ONCO-2024-01;AE;migrane',
      target_status: 'open',
      failure_reason: 'States.Timeout',
    });

    const call = mockExecute.mock.calls[0];
    expect(paramValue(call, 'by')).toEqual({
      stringValue: 'autocoding-workflow:error:States.Timeout',
    });
  });
});
