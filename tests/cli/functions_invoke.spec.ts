import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { fixture, mswServer, setupCLITests } from "./testkit/index.js";

describe("functions invoke command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("functions", "invoke", "my-function");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("invokes function successfully with POST", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    // Mock the function invocation endpoint at the published URL
    mswServer.use(
      http.post("https://test-app.base44.app/api/functions/my-function", () =>
        HttpResponse.json({ success: true, result: "Hello" }),
      ),
    );

    const result = await t.run("functions", "invoke", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Function executed successfully");
    t.expectResult(result).toContain("success");
  });

  it("invokes function with custom method", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    // Mock the function invocation endpoint at the published URL
    mswServer.use(
      http.get("https://test-app.base44.app/api/functions/my-function", () =>
        HttpResponse.json({ data: "fetched" }),
      ),
    );

    const result = await t.run(
      "functions",
      "invoke",
      "my-function",
      "-X",
      "GET",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Function executed successfully");
    t.expectResult(result).toContain("fetched");
  });

  it("invokes function with custom headers", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    let capturedHeaders: Headers | undefined;
    mswServer.use(
      http.post(
        "https://test-app.base44.app/api/functions/my-function",
        ({ request }) => {
          capturedHeaders = request.headers;
          return HttpResponse.json({ success: true });
        },
      ),
    );

    const result = await t.run(
      "functions",
      "invoke",
      "my-function",
      "-H",
      "X-Custom: test-value",
    );

    t.expectResult(result).toSucceed();
    if (capturedHeaders) {
      expect(capturedHeaders.get("X-Custom")).toBe("test-value");
    }
  });

  it("invokes function with JSON data", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    let capturedBody: unknown;
    mswServer.use(
      http.post(
        "https://test-app.base44.app/api/functions/my-function",
        async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true });
        },
      ),
    );

    const result = await t.run(
      "functions",
      "invoke",
      "my-function",
      "-d",
      '{"name": "test", "count": 42}',
    );

    t.expectResult(result).toSucceed();
    expect(capturedBody).toEqual({ name: "test", count: 42 });
  });

  it("fails with invalid JSON data", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    const result = await t.run(
      "functions",
      "invoke",
      "my-function",
      "-d",
      "not-valid-json",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid JSON data");
  });

  it("fails when function returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    mswServer.use(
      http.post("https://test-app.base44.app/api/functions/my-function", () =>
        HttpResponse.json(
          { error: "Function execution failed" },
          { status: 500 },
        ),
      ),
    );

    const result = await t.run("functions", "invoke", "my-function");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("invoking function");
  });

  it("fails when site URL is not available", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrlError({ status: 404, body: { error: "Not found" } });

    const result = await t.run("functions", "invoke", "my-function");

    t.expectResult(result).toFail();
  });

  it("invokes function with multiple headers", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    let capturedHeaders: Headers | undefined;
    mswServer.use(
      http.post(
        "https://test-app.base44.app/api/functions/my-function",
        ({ request }) => {
          capturedHeaders = request.headers;
          return HttpResponse.json({ success: true });
        },
      ),
    );

    const result = await t.run(
      "functions",
      "invoke",
      "my-function",
      "-H",
      "X-Custom-1: value1",
      "-H",
      "X-Custom-2: value2",
    );

    t.expectResult(result).toSucceed();
    if (capturedHeaders) {
      expect(capturedHeaders.get("X-Custom-1")).toBe("value1");
      expect(capturedHeaders.get("X-Custom-2")).toBe("value2");
    }
  });
});
