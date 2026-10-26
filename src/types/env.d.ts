// Secrets are not declared in wrangler.jsonc, so `wrangler types` cannot see
// them. Declare them here (interface merging with the generated CloudflareEnv).
interface CloudflareEnv {
  /** OpenAI project API key. Server-side only; never sent to the browser. */
  OPENAI_API_KEY?: string;
  /** Optional override, e.g. a regional endpoint or a local test forwarder. */
  OPENAI_BASE_URL?: string;
  /**
   * "1" when an egress proxy/gateway injects the OpenAI credential itself.
   * Requests are then sent without an Authorization header and
   * OPENAI_API_KEY may be empty.
   */
  OPENAI_PROXY_AUTH?: string;
  /**
   * Comma-separated e-mails allowed to create an account ("*@domain" and "*"
   * are accepted). When empty, only the very first account can be created
   * (the instance owner).
   */
  ALLOWED_SIGNUP_EMAILS?: string;
}
