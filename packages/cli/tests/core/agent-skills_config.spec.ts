import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readAllAgentSkills,
  writeAgentSkills,
} from "../../src/core/resources/agent-skill/config.js";

describe("agent-skill config", () => {
  it("reads a .md skill file (name from filename, description from frontmatter, body below)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    try {
      await writeFile(
        join(dir, "weekly-report.md"),
        "---\ndescription: Summarize the week.\n---\n\nRead tasks from the last 7 days.\n",
      );
      const skills = await readAllAgentSkills(dir);
      expect(skills).toEqual([
        {
          name: "weekly-report",
          description: "Summarize the week.",
          body: "Read tasks from the last 7 days.",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips: writeAgentSkills then readAllAgentSkills", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    try {
      const { written } = await writeAgentSkills(dir, [
        {
          name: "code-review",
          description: "Review a diff.",
          body: "Check for bugs.",
        },
      ]);
      expect(written).toEqual(["code-review"]);
      const raw = await readFile(join(dir, "code-review.md"), "utf-8");
      expect(raw).toContain("description: Review a diff.");
      expect(raw.trimEnd().endsWith("Check for bugs.")).toBe(true);
      expect(await readAllAgentSkills(dir)).toEqual([
        {
          name: "code-review",
          description: "Review a diff.",
          body: "Check for bugs.",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deletes local skills not present in the remote list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    try {
      await writeAgentSkills(dir, [
        { name: "keep", description: "d", body: "b" },
        { name: "drop", description: "d", body: "b" },
      ]);
      const { deleted } = await writeAgentSkills(dir, [
        { name: "keep", description: "d", body: "b" },
      ]);
      expect(deleted).toEqual(["drop"]);
      expect((await readAllAgentSkills(dir)).map((s) => s.name)).toEqual([
        "keep",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns [] when the directory does not exist", async () => {
    expect(
      await readAllAgentSkills(join(tmpdir(), "nope-does-not-exist")),
    ).toEqual([]);
  });

  it("rejects a skill file whose name is not lowercase-hyphenated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    try {
      await writeFile(
        join(dir, "Bad_Name.md"),
        "---\ndescription: has a bad name\n---\n\nbody\n",
      );
      await expect(readAllAgentSkills(dir)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a skill file with an empty body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    try {
      await writeFile(
        join(dir, "empty-body.md"),
        "---\ndescription: has no body\n---\n",
      );
      await expect(readAllAgentSkills(dir)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
