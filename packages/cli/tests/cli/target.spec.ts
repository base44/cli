import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("target", () => {
  const t = setupCLITests();

  it("stores a target with a flag override, shows it, and clears it", async () => {
    const set = await t.run(
      "target",
      "https://docker-pr-24793.velino.org",
      "--ff",
      "imported-apps:true",
      "--json",
    );
    t.expectResult(set).toSucceed();

    const show = await t.run("target", "--json");
    t.expectResult(show).toSucceed();
    expect(JSON.parse(show.stdout)).toMatchObject({
      stored_api_url: "https://docker-pr-24793.velino.org",
      ff_override: "imported-apps:true",
    });

    const clear = await t.run("target", "--clear", "--json");
    t.expectResult(clear).toSucceed();
    const after = await t.run("target", "--json");
    expect(JSON.parse(after.stdout)).toMatchObject({
      stored_api_url: null,
      ff_override: null,
    });
  });

  it("rejects a bare hostname", async () => {
    const result = await t.run("target", "docker-pr-1.velino.org", "--json");
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain("full URL");
  });
});
