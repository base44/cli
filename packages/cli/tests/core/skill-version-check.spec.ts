import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaleSkillInfo } from "@/cli/utils/skill-version-check.js";
import {
  formatPlainSkillWarning,
  readSkillFrontmatter,
} from "@/cli/utils/skill-version-check.js";

const FIXTURES_DIR = resolve(__dirname, "../fixtures/with-skills");

describe("readSkillFrontmatter", () => {
  it("parses sourcePackage from metadata frontmatter", async () => {
    const result = await readSkillFrontmatter(
      resolve(FIXTURES_DIR, "skill-with-source-package"),
    );

    expect(result).not.toBeNull();
    expect(result!.metadata.sourcePackage.name).toBe("base44");
    expect(result!.metadata.sourcePackage.version).toBe("0.0.1");
  });

  it("returns null when metadata is missing", async () => {
    const result = await readSkillFrontmatter(
      resolve(FIXTURES_DIR, "skill-without-metadata"),
    );

    expect(result).toBeNull();
  });

  it("parses sourcePackage from a different package", async () => {
    const result = await readSkillFrontmatter(
      resolve(FIXTURES_DIR, "skill-different-package"),
    );

    expect(result).not.toBeNull();
    expect(result!.metadata.sourcePackage.name).toBe("other-package");
    expect(result!.metadata.sourcePackage.version).toBe("1.0.0");
  });

  it("returns null when skill directory does not exist", async () => {
    const result = await readSkillFrontmatter(
      resolve(FIXTURES_DIR, "nonexistent-skill"),
    );

    expect(result).toBeNull();
  });

  it("returns null when SKILL.md is missing from directory", async () => {
    // Use the parent fixtures dir which has no SKILL.md
    const result = await readSkillFrontmatter(FIXTURES_DIR);

    expect(result).toBeNull();
  });
});

describe("formatPlainSkillWarning", () => {
  it("formats a single stale skill", () => {
    const staleSkills: StaleSkillInfo[] = [
      {
        skillName: "base44-cli",
        installedVersion: "0.0.1",
        currentVersion: "0.0.48",
      },
    ];

    const result = formatPlainSkillWarning(staleSkills);

    expect(result).toContain("base44-cli");
    expect(result).toContain("v0.0.1");
    expect(result).toContain("v0.0.48");
    expect(result).toContain("base44 agent-skills update");
  });

  it("formats multiple stale skills", () => {
    const staleSkills: StaleSkillInfo[] = [
      {
        skillName: "base44-cli",
        installedVersion: "0.0.1",
        currentVersion: "0.0.48",
      },
      {
        skillName: "base44-sdk",
        installedVersion: "0.0.2",
        currentVersion: "0.0.48",
      },
    ];

    const result = formatPlainSkillWarning(staleSkills);

    expect(result).toContain("base44-cli");
    expect(result).toContain("base44-sdk");
    expect(result).toContain("base44 agent-skills update");
  });
});
