import { describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("local actor requests", () => {
  const t = setupCLITests();

  it.each([
    "basic",
    "with-actors",
  ])("blocks actor requests without forwarding them (%s)", async (project) => {
    await t.givenLoggedInWithProject(fixture(project));
    const handle = await t.runLive("dev");
    const url = await waitForDevServer(handle);
    const response = await fetch(
      `${url}/api/apps/${t.api.appId}/actors/ChatRoom/connection-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: "lobby", connection_id: "local-test" }),
      },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Actors are not available in local development",
    });
    const result = await handle.stop();
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(
      "Actors are not available in local development",
    );
    t.expectResult(result).toNotContain("passing call to production");
  });
});
