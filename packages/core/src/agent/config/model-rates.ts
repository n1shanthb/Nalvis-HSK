/** Review-round-1 rate configuration: USD per million tokens. Estimates only. */
export type TokenRates = { inputPerMillion: number; outputPerMillion: number };
export const modelRates: Readonly<Record<string, TokenRates>> = {
  'anthropic/claude-haiku-5.5': { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  'xiaomi/mimo-v2.6-flash': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
};
/** Conservative fallback for unlisted models, charged per token, never per call. */
export const defaultTokenRates: TokenRates = {
  inputPerMillion: 1,
  outputPerMillion: 3,
};
