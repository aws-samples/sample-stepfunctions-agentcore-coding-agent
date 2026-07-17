/**
 * Terminal Lambda for the coding workflow. Placeholder: parses the
 * CodingAgent's (AgentCore Harness) message text and returns it unchanged as
 * the workflow's final output. Real finalize logic depends on parameters not
 * yet decided.
 *
 * AgentCore Harness observability isn't wired up for this demo (the fully
 * managed CreateHarness resource type has no exposed tracing control in
 * CDK/CLI/API as of this writing - confirmed by testing the delivery-source
 * mechanism live, which is documented as memory/gateway-only), so there's no
 * trace to confirm whether get_weather was actually called. Instead this
 * Lambda validates the shape of what came back: get_weather always returns
 * a value ending in "C" (see lambda/tools/weather/index.ts) - if the parsed
 * temperature doesn't match that shape, the model didn't relay the tool's
 * real output (fabricated an answer, converted units, etc.), so this throws
 * rather than silently returning a wrong result.
 */

// The ASL (JSONata) extracts the agent's final assistant text and passes it
// directly as { text }, so this Lambda no longer navigates the nested harness
// response shape itself - see state-machine/coding-workflow.asl.yaml Finalize.
interface FinalizeInput {
  text: string;
}

export const handler = async (event: FinalizeInput) => {
  const text = event.text;

  let parsed: { temperature?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`CodingAgent output was not valid JSON: ${(err as Error).message}. Raw text: ${text}`);
  }

  // Off-topic (non-weather) prompts are answered with an empty {} by the
  // system prompt (see coding-workflow.asl.yaml) - a valid, expected outcome,
  // not an error. Pass it through as a null result.
  if (parsed.temperature === undefined) {
    return { result: null };
  }

  if (typeof parsed.temperature !== 'string' || !/^-?\d+C$/.test(parsed.temperature)) {
    throw new Error(
      `CodingAgent did not relay get_weather's actual output (expected a bare "<number>C" value, e.g. "27C"). Got: ${JSON.stringify(parsed.temperature)}. Raw text: ${text}`
    );
  }

  return { result: parsed.temperature };
};
