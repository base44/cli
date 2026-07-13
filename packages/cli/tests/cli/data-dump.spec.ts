import { describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

interface DumpOutput {
  entities: Record<string, { pulled: number; total: number }>;
  wrote: string[];
}

describe("data dump command", () => {
  const t = setupCLITests();

  const seedLocalData = async () => {
    const result = await t.run("dev", "seed", "--json");
    t.expectResult(result).toSucceed();
  };

  it("dumps local data offline into fixtures, skipping users", async () => {
    // Given: offline-seeded data (2 tasks with ids, 1 team member)
    await t.givenLoggedInWithProject(fixture("with-seed"));
    await seedLocalData();

    // When
    const result = await t.run("data", "dump", "--force", "--json");

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout) as DumpOutput;
    expect(output.entities).toEqual({
      Task: { pulled: 2, total: 2 },
      TeamMember: { pulled: 1, total: 1 },
    });
    expect(output.wrote).toHaveLength(2);

    const tasks = JSON.parse(
      (await t.readProjectFile("base44/seed/task.jsonc")) as string,
    ) as Record<string, unknown>[];
    expect(tasks).toHaveLength(2);
    const taskOne = tasks.find((task) => task.id === "task-1");
    expect(taskOne).toMatchObject({
      title: "First seeded task",
      created_by: "admin@seed.dev",
    });
    // NeDB's internal _id never leaks into fixtures
    expect(Object.keys(taskOne ?? {})).not.toContain("_id");
  });

  it("dumps from a running dev server via the admin export endpoint", async () => {
    // Given: startup auto-seed applied 3 tasks (replace mode)
    await t.givenLoggedInWithProject(fixture("with-seed"));
    const handle = await t.runLive("dev");
    await waitForDevServer(handle);

    // When
    const result = await t.run("data", "dump", "--force", "--json");

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout) as DumpOutput;
    expect(output.entities.Task).toEqual({ pulled: 3, total: 3 });
    expect(output.entities.TeamMember).toEqual({ pulled: 1, total: 1 });

    await handle.stop();
  });

  it("dumps only the requested entity", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-seed"));
    await seedLocalData();

    // When
    const result = await t.run(
      "data",
      "dump",
      "--entity",
      "Task",
      "--force",
      "--json",
    );

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout) as DumpOutput;
    expect(Object.keys(output.entities)).toEqual(["Task"]);
  });

  it("warns and skips when User is requested", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-seed"));
    await seedLocalData();

    // When
    const result = await t.run("data", "dump", "--entity", "User", "--json");

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("skipping User");
    const output = JSON.parse(result.stdout) as DumpOutput;
    expect(output.entities).toEqual({});
    expect(output.wrote).toEqual([]);
    expect(await t.fileExists("base44/seed/user.jsonc")).toBe(false);
  });

  it("skips empty collections when dumping everything", async () => {
    // Given: no seeding — collections exist but are empty
    await t.givenLoggedInWithProject(fixture("with-entities"));

    // When
    const result = await t.run("data", "dump", "--json");

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout) as DumpOutput;
    expect(output.entities).toEqual({});
    expect(output.wrote).toEqual([]);
  });

  it("rejects an unknown --entity listing known names", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-seed"));
    await seedLocalData();

    // When
    const result = await t.run("data", "dump", "--entity", "Ghost");

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain('Unknown entity "Ghost"');
    t.expectResult(result).toContain("Task");
  });

  it("writes to --out and requires --force for existing fixtures", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-seed"));
    await seedLocalData();

    // When: default out dir collides with existing fixtures
    const withoutForce = await t.run("data", "dump");
    // When: a fresh --out dir does not
    const withOut = await t.run("data", "dump", "--out", "exported", "--json");

    // Then
    t.expectResult(withoutForce).toFail();
    t.expectResult(withoutForce).toContain("--force");
    t.expectResult(withOut).toSucceed();
    expect(await t.fileExists("exported/task.jsonc")).toBe(true);
    expect(await t.fileExists("exported/team-member.jsonc")).toBe(true);
  });
});
