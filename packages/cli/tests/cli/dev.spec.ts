import { writeFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("forwards the service token header from Authorization to local functions", async () => {
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
      `Deno.serve((req: Request) =>
  Response.json({
    authorization: req.headers.get("authorization"),
    serviceAuthorization: req.headers.get("base44-service-authorization"),
  }),
);
`,
    );

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/functions/hello`,
      {
        headers: {
          Authorization: "Bearer test-app-token",
          "X-App-Id": t.api.appId,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorization: "Bearer test-app-token",
      serviceAuthorization: "Bearer test-app-token",
    });

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});
