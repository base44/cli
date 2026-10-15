import { describe, expect, it } from "vitest";
import { reportedFetchCommand } from "../../src/cli/commands/api/shared.js";
import { redactedApiError } from "../../src/core/api-spec/request.js";
import { ApiError } from "../../src/core/errors.js";

// Error reporting sends ApiError fields and command options to PostHog, and
// any endpoint `api fetch` reaches can carry secrets.
describe("api fetch error reporting", () => {
  const failed = new ApiError("Error calling POST /api/apps/a1/secrets: Bad", {
    statusCode: 422,
    requestUrl: "https://app.base44.com/api/apps/a1/secrets?token=t0k",
    requestMethod: "POST",
    requestBody: '{"name":"STRIPE_KEY","value":"sk_live_123"}',
    responseBody: { detail: "sk_live_123 is not valid" },
    requestId: "req-1",
  });

  it("drops both bodies and the query string from the error", () => {
    const reported = redactedApiError(
      failed,
      '{"detail":"sk_live_123 is not valid"}',
      "POST",
      "/api/apps/a1/secrets?token=t0k",
    );

    expect(reported.requestBody).toBeUndefined();
    expect(reported.responseBody).toBeUndefined();
    expect(reported.requestUrl).toBe(
      "https://app.base44.com/api/apps/a1/secrets",
    );
    expect(reported.message).toBe(
      "Error calling POST /api/apps/a1/secrets: HTTP 422",
    );
    expect(reported).toMatchObject({ statusCode: 422, requestId: "req-1" });
  });

  it("gives the caller the server's raw reply in the details", () => {
    const reported = redactedApiError(failed, '{"detail":"x"}', "POST", "/p");

    expect(reported.details).toEqual(['Response body: {"detail":"x"}']);
  });

  it("records the command without --body or the query string", () => {
    expect(
      reportedFetchCommand("POST", "/api/apps/a1/secrets?token=t0k", {
        body: '{"value":"sk_live_123"}',
        readOnly: true,
      }),
    ).toEqual({
      name: "api fetch",
      args: ["POST", "/api/apps/a1/secrets"],
      options: { body: "[not reported]", readOnly: true },
    });
  });

  it("leaves options without a body as they are", () => {
    expect(reportedFetchCommand("GET", "/api/apps", {}).options).toEqual({});
  });
});
