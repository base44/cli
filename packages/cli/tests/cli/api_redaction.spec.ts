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

    expect(reported.details).toEqual([
      'Response body: {"detail":"x"}',
      "Request ID: req-1",
    ]);
  });

  it("names only the status when the error body is empty", () => {
    const reported = redactedApiError(
      failed,
      undefined,
      "POST",
      "/api/apps/a1/secrets?token=t0k",
    );

    expect(reported.message).toBe(
      "Error calling POST /api/apps/a1/secrets: HTTP 422",
    );
  });

  it("keeps a network error's words without the query string", () => {
    const networkError = new ApiError(
      "Error calling GET /api/x?token=t0k: Request timed out: GET https://h/api/x?token=t0k",
      {
        cause: new Error(
          "Request timed out: GET https://h/api/x?token=t0k after 10s",
        ),
      },
    );

    const reported = redactedApiError(
      networkError,
      undefined,
      "GET",
      "/api/x?token=t0k",
    );

    expect(reported.message).toBe(
      "Error calling GET /api/x: Request timed out: GET https://h/api/x after 10s",
    );
    expect(reported.cause).toBeUndefined();
  });

  it("adds the server's Retry-After wait to the message", () => {
    const limited = new ApiError("Error calling POST /p: limited", {
      statusCode: 429,
    });

    expect(
      redactedApiError(limited, undefined, "POST", "/p", "30").message,
    ).toBe("Error calling POST /p: HTTP 429 (retry after 30 s)");
    expect(
      redactedApiError(
        limited,
        undefined,
        "POST",
        "/p",
        "Wed, 21 Oct 2026 07:28:00 GMT",
      ).message,
    ).toBe(
      "Error calling POST /p: HTTP 429 (retry after Wed, 21 Oct 2026 07:28:00 GMT)",
    );
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

  it("records the command without --form values", () => {
    expect(
      reportedFetchCommand("POST", "/api/fonts", {
        form: ["file=@font.ttf", "token=sk_live_123"],
      }).options,
    ).toEqual({ form: "[not reported]" });
  });

  it("leaves options without a body as they are", () => {
    expect(reportedFetchCommand("GET", "/api/apps", {}).options).toEqual({});
  });
});
