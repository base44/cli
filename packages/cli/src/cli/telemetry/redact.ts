const REDACTED = "[REDACTED]";

/**
 * Redact user-supplied values from positional command args before they are
 * attached to telemetry events. Args shaped like KEY=VALUE (e.g.
 * `base44 secrets set STRIPE_KEY=sk_live_...`) keep the key but drop the
 * value, which may be a secret.
 */
export function redactCommandArgs(args: string[]): string[] {
  return args.map((arg) => {
    const eqIndex = arg.indexOf("=");
    return eqIndex > 0 ? `${arg.slice(0, eqIndex + 1)}${REDACTED}` : arg;
  });
}

/** URL paths whose request/response bodies contain plaintext secret values. */
const SENSITIVE_URL_PATTERN = /\/secrets(\/|\?|$)/;

/**
 * Redact API request/response bodies for endpoints that carry plaintext
 * secrets. The whole body is dropped rather than picking fields, since
 * secret names are user-defined and cannot be allowlisted.
 */
export function redactApiBody(
  requestUrl: string | undefined,
  body: unknown,
): unknown {
  if (body === undefined || body === null) {
    return body;
  }
  if (requestUrl && SENSITIVE_URL_PATTERN.test(requestUrl)) {
    return REDACTED;
  }
  return body;
}
