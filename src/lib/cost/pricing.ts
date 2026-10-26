// Model prices in USD. Source: https://developers.openai.com/api/docs/pricing
// (Standard tier), checked on 2026-10-26. Prices change: costs computed here
// are ESTIMATES shown as such in the UI. Update this table when OpenAI
// publishes new prices; unknown models fall back to a conservative estimate.

export interface TokenPrice {
  kind: "tokens";
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}
export interface MinutePrice {
  kind: "minute";
  perMinute: number;
}
export type Price = TokenPrice | MinutePrice;

export const PRICING_CHECKED_AT = "2026-10-26";

export const PRICES: Record<string, Price> = {
  "gpt-6-astra": { kind: "tokens", inputPerMTok: 10, cachedInputPerMTok: 1, outputPerMTok: 50 },
  "gpt-6.1-sol": { kind: "tokens", inputPerMTok: 2, cachedInputPerMTok: 0.1, outputPerMTok: 10 },
  "gpt-6-sol": { kind: "tokens", inputPerMTok: 2, cachedInputPerMTok: 0.2, outputPerMTok: 10 },
  "gpt-6-luna": { kind: "tokens", inputPerMTok: 0.1, cachedInputPerMTok: 0.01, outputPerMTok: 0.5 },
  "gpt-5.6-terra": { kind: "tokens", inputPerMTok: 2, cachedInputPerMTok: 0.2, outputPerMTok: 12 },
  "gpt-5.6-luna": { kind: "tokens", inputPerMTok: 0.2, cachedInputPerMTok: 0.02, outputPerMTok: 1.2 },
  "gpt-5.5": { kind: "tokens", inputPerMTok: 5, cachedInputPerMTok: 0.5, outputPerMTok: 30 },
  "gpt-5.4": { kind: "tokens", inputPerMTok: 2.5, cachedInputPerMTok: 0.25, outputPerMTok: 15 },
  "gpt-5.4-mini": { kind: "tokens", inputPerMTok: 0.75, cachedInputPerMTok: 0.075, outputPerMTok: 4.5 },
  "text-embedding-3-small": { kind: "tokens", inputPerMTok: 0.02, cachedInputPerMTok: 0.02, outputPerMTok: 0 },
  "text-embedding-3-large": { kind: "tokens", inputPerMTok: 0.13, cachedInputPerMTok: 0.13, outputPerMTok: 0 },
  "gpt-live-transcribe": { kind: "minute", perMinute: 0.017 },
  "gpt-transcribe": { kind: "minute", perMinute: 0.0045 },
};

const FALLBACK_TOKENS: TokenPrice = { kind: "tokens", inputPerMTok: 10, cachedInputPerMTok: 1, outputPerMTok: 50 };
const FALLBACK_MINUTE: MinutePrice = { kind: "minute", perMinute: 0.02 };

/** Prompts above this size are billed at 2x input and 1.5x output. */
const LONG_CONTEXT_TOKENS = 272_000;

export function tokenCost(model: string, input: number, cachedInput: number, output: number): number {
  const p = PRICES[model];
  const price = p && p.kind === "tokens" ? p : FALLBACK_TOKENS;
  const long = input > LONG_CONTEXT_TOKENS;
  const uncached = Math.max(0, input - cachedInput);
  return (
    ((uncached * price.inputPerMTok + cachedInput * price.cachedInputPerMTok) * (long ? 2 : 1) +
      output * price.outputPerMTok * (long ? 1.5 : 1)) /
    1_000_000
  );
}

export function audioCost(model: string, seconds: number): number {
  const p = PRICES[model];
  const price = p && p.kind === "minute" ? p : FALLBACK_MINUTE;
  return (seconds / 60) * price.perMinute;
}

/** Rough token count for planning (≈4 characters per token for es/en). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
