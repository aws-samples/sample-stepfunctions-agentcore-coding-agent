/**
 * Gateway tool `get_weather`, called by the CodingAgent. Placeholder for a
 * real dictionary/coding lookup tool - returns a static value so the
 * end-to-end AgentCore Harness -> Gateway -> Lambda tool path can be
 * exercised before real tool parameters are decided.
 */
export const handler = async () => {
  return { temperature: '27C' };
};
