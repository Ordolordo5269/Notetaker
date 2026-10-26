import { describe, expect, it } from "vitest";
import { OpenAIError } from "@/lib/openai/client";

describe("OpenAI upstream errors as seen by the browser", () => {
  it("never reports an invalid server key as a 401 of our own session", () => {
    for (const upstream of [401, 403]) {
      const err = new OpenAIError(upstream, "Incorrect API key provided", false);
      expect(err.status).toBe(502);
      expect(err.code).toBe("openai_auth");
      expect(err.message).toContain("OPENAI_API_KEY");
      expect(err.upstreamStatus).toBe(upstream);
    }
  });
  it("maps rate limits, outages and bad requests to 502 and keeps refusals at 422", () => {
    expect(new OpenAIError(429, "rate", true).status).toBe(502);
    expect(new OpenAIError(503, "down", true).status).toBe(502);
    expect(new OpenAIError(400, "bad request", false).status).toBe(502);
    expect(new OpenAIError(422, "refusal", false).status).toBe(422);
    expect(new OpenAIError(400, "bad request", false).code).toBe("openai_error");
  });
});
