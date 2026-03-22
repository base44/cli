import { describe, it } from "vitest";
import { fixture, type RunLiveHandle, setupCLITests } from "./testkit/index.js";

const waitForDevServer = async (
  runLiveHandle: RunLiveHandle,
): Promise<string> => {
  const pattern = /Dev server is available at (http\S+)/;
  await runLiveHandle.waitForOutput(pattern);
  const match = runLiveHandle.stdout.join("").match(pattern)!;
  return match[1];
};

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
});
