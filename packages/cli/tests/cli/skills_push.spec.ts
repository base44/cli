import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const APP_ID = "test-app-id";
const base = `/api/apps/${APP_ID}/sandbox-bridge`;

interface WriteCall {
  path: string;
  content: string;
  overwrite?: boolean;
}

describe("sandbox push-skills", () => {
  const t = setupCLITests();

  /** Mock write_file and record every call the CLI makes. */
  function captureWrites(): WriteCall[] {
    const calls: WriteCall[] = [];
    t.api.mockRoute("POST", `${base}/write_file`, (req, res) => {
      calls.push({
        path: req.body.path,
        content: req.body.content,
        overwrite: req.body.overwrite,
      });
      res.status(200).json({
        path: req.body.path,
        bytes_written: (req.body.content ?? "").length,
        created: true,
        overwritten: false,
      });
    });
    return calls;
  }

  it("copies a single-skill directory without asking which to copy", async () => {
    // Given — the directory itself holds SKILL.md, so there is nothing to pick
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const calls = captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/single"),
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toSucceed();
    expect(calls.map((call) => call.path).sort()).toEqual([
      ".agents/skills/single/SKILL.md",
      ".agents/skills/single/scripts/run.sh",
    ]);
  });

  it("--all copies every discovered skill under .agents/skills", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const calls = captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/multi"),
      "--all",
      "--app-id",
      APP_ID,
    );

    // Then — bundled files travel too, and non-skill directories are ignored
    t.expectResult(result).toSucceed();
    expect(calls.map((call) => call.path).sort()).toEqual([
      ".agents/skills/grill-me/SKILL.md",
      ".agents/skills/grill-me/references/api.md",
      ".agents/skills/tidy-up/SKILL.md",
    ]);
    t.expectResult(result).toNotContain("not-a-skill");
  });

  it("--name copies only the named skills", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const calls = captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/multi"),
      "--name",
      "tidy-up",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toSucceed();
    expect(calls.map((call) => call.path)).toEqual([
      ".agents/skills/tidy-up/SKILL.md",
    ]);
  });

  it("fails when --name does not match a discovered skill", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/multi"),
      "--name",
      "nope",
      "--app-id",
      APP_ID,
    );

    // Then — the error names what was actually found
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No such skill: nope");
    t.expectResult(result).toContain("grill-me");
  });

  it("requires --all or --name in non-interactive mode", async () => {
    // Given — more than one skill, so a choice is needed and no prompt is possible
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/multi"),
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "Pass --all or --name <name> to choose in non-interactive mode",
    );
  });

  it("--overwrite is forwarded to the sandbox bridge", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const calls = captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/single"),
      "--overwrite",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toSucceed();
    expect(calls.every((call) => call.overwrite === true)).toBe(true);
  });

  it("never writes binary files, and explains that they are unsupported", async () => {
    // Given — the skill bundles a file containing NUL bytes
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const calls = captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/with-binary"),
      "--app-id",
      APP_ID,
    );

    // Then — the text file still ships, the binary one does not
    t.expectResult(result).toSucceed();
    expect(calls.map((call) => call.path)).toEqual([
      ".agents/skills/with-binary/SKILL.md",
    ]);
    t.expectResult(result).toContain("Binary files are not supported");
    t.expectResult(result).toContain("with-binary/assets/logo.bin");
  });

  it("rejects --all and --name together", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/multi"),
      "--all",
      "--name",
      "tidy-up",
      "--app-id",
      APP_ID,
    );

    // Then — --name would otherwise silently narrow --all
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Pass either --all or --name, not both");
  });

  it("--json reports what was written and what was skipped", async () => {
    // Given — the skill bundles a binary file that cannot be copied
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    captureWrites();

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/with-binary"),
      "--app-id",
      APP_ID,
      "--json",
    );

    // Then — stdout parses cleanly and carries the full outcome
    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.destination).toBe(".agents/skills");
    expect(parsed.skills).toEqual([
      {
        skill: "with-binary",
        written: [".agents/skills/with-binary/SKILL.md"],
        skippedBinary: ["assets/logo.bin"],
      },
    ]);
    expect(result.stdout).not.toContain("Copied");
  });

  it("explains when the directory holds no skills", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When
    const result = await t.run(
      "sandbox",
      "push-skills",
      fixture("local-skills/empty"),
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No skills found");
  });
});
