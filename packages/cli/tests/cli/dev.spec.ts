import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { outdent } from "outdent";
import { describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("dev command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("dev");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("starts dev server successfully", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    const result = await handle.stop();

    t.expectResult(result).toSucceed();
  });

  it("sets a local service token header for functions", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    await writeFile(
      join(
        t.getTempDir(),
        "project",
        "base44",
        "functions",
        "hello",
        "index.ts",
      ),
      outdent`
        Deno.serve((req: Request) =>
          Response.json({
            authorization: req.headers.get("authorization"),
            serviceAuthorization: req.headers.get("base44-service-authorization"),
          }),
        );
      `,
    );

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    const functionUrl = `${devServerUrl}/api/apps/${t.api.appId}/functions/hello`;
    const requestFunction = (headers: Record<string, string>) =>
      fetch(functionUrl, { headers });

    const anonymousResponse = await requestFunction({
      "X-App-Id": t.api.appId,
    });
    expect(anonymousResponse.status).toBe(200);
    await expect(anonymousResponse.json()).resolves.toEqual({
      authorization: null,
      serviceAuthorization: "Bearer dev",
    });

    const authenticatedResponse = await requestFunction({
      Authorization: "Bearer test-app-token",
      "X-App-Id": t.api.appId,
    });
    expect(authenticatedResponse.status).toBe(200);
    await expect(authenticatedResponse.json()).resolves.toEqual({
      authorization: "Bearer test-app-token",
      serviceAuthorization: "Bearer dev",
    });

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});
