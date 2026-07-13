import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("dev seed script (base44/seed.ts)", () => {
  const t = setupCLITests();

  const writeSeedScript = async () => {
    await writeFile(
      join(t.getTempDir(), "project", "base44", "seed.ts"),
      "export default async (ctx) => { ctx.log('seeding'); };",
    );
  };

  describe("dev seed (offline, temporary instance)", () => {
    it("applies fixtures and runs the script via a temporary dev server", async () => {
      // Given
      await t.givenLoggedInWithProject(fixture("with-seed"));
      await writeSeedScript();
      t.givenSeedScriptResult(0);

      // When
      const result = await t.run("dev", "seed", "--json");

      // Then
      t.expectResult(result).toSucceed();
      const summary = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(summary).toMatchObject({
        applied: true,
        mode: "upsert",
        users: 2,
        records: {
          Task: { created: 2, updated: 0, skipped: 1 },
          TeamMember: { created: 1, updated: 0, skipped: 0 },
        },
        script: { ran: true },
        warnings: [],
      });
    });

    it("keeps fixture results, warns, and exits non-zero when the script fails", async () => {
      // Given
      await t.givenLoggedInWithProject(fixture("with-seed"));
      await writeSeedScript();
      t.givenSeedScriptResult(3);

      // When
      const result = await t.run("dev", "seed", "--json");

      // Then
      t.expectResult(result).toFail();
      const summary = JSON.parse(result.stdout) as {
        records: Record<string, unknown>;
        script: { ran: boolean };
        warnings: string[];
      };
      expect(summary.records.Task).toEqual({
        created: 2,
        updated: 0,
        skipped: 1,
      });
      expect(summary.script).toEqual({ ran: false });
      expect(summary.warnings.join("\n")).toContain("exited with code 3");
    });
  });

  describe("dev seed (live server)", () => {
    it("runs the script step against the running server", async () => {
      // Given: server starts without a script, so startup seeding is fixture-only
      await t.givenLoggedInWithProject(fixture("with-seed"));
      t.givenSeedScriptResult(0);
      const handle = await t.runLive("dev");
      await waitForDevServer(handle);
      await writeSeedScript();

      // When
      const result = await t.run("dev", "seed", "--json");

      // Then
      t.expectResult(result).toSucceed();
      const summary = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(summary).toMatchObject({
        applied: true,
        mode: "upsert",
        script: { ran: true },
      });

      await handle.stop();
    });
  });

  describe("startup auto-seed", () => {
    it("runs the script after listen and logs a single summary", async () => {
      // Given
      await t.givenLoggedInWithProject(fixture("with-seed"));
      await writeSeedScript();
      t.givenSeedScriptResult(0);

      // When
      const handle = await t.runLive("dev");
      await waitForDevServer(handle);
      await handle.waitForOutput(/Seeds applied/);

      // Then: seed state recorded in dev.json
      const devJson = JSON.parse(
        (await t.readProjectFile(".base44/dev.json")) as string,
      ) as Record<string, unknown>;
      expect(devJson.seed).toMatchObject({
        hash: expect.stringMatching(/^sha256:/),
      });

      await handle.stop();
    });

    it("keeps serving when the script fails", async () => {
      // Given
      await t.givenLoggedInWithProject(fixture("with-seed"));
      await writeSeedScript();
      t.givenSeedScriptResult(1);

      // When: the server still comes up
      const handle = await t.runLive("dev");
      await waitForDevServer(handle);

      // Then: fixtures applied, warning logged to stderr
      expect(handle.stderr.join("")).toContain("exited with code 1");
      const result = await handle.stop();
      expect(result.stdout).toContain("Seeds applied");
    });
  });

  describe("dev reset", () => {
    it("re-seeds and runs the script via a temporary instance (offline)", async () => {
      // Given
      await t.givenLoggedInWithProject(fixture("with-seed"));
      await writeSeedScript();
      t.givenSeedScriptResult(0);

      // When
      const result = await t.run("dev", "reset", "--force", "--json");

      // Then
      t.expectResult(result).toSucceed();
      const reset = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(reset).toMatchObject({
        reset: true,
        seeded: true,
        seed: {
          mode: "replace",
          records: { Task: { created: 3, updated: 0, skipped: 0 } },
          script: { ran: true },
        },
      });
    });

    it("exits non-zero when the script fails during reset", async () => {
      // Given
      await t.givenLoggedInWithProject(fixture("with-seed"));
      await writeSeedScript();
      t.givenSeedScriptResult(2);

      // When
      const result = await t.run("dev", "reset", "--force", "--json");

      // Then
      t.expectResult(result).toFail();
      const reset = JSON.parse(result.stdout) as {
        seed: { script: { ran: boolean }; warnings: string[] };
      };
      expect(reset.seed.script).toEqual({ ran: false });
      expect(reset.seed.warnings.join("\n")).toContain("exited with code 2");
    });
  });
});
