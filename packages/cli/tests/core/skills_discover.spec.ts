import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidInputError } from "../../src/core/errors.js";
import { discoverLocalSkills } from "../../src/core/skills/discover.js";
import {
  assertSafeDirName,
  assertSafeRelativePath,
  assertWithinSkillRoot,
  isBinary,
} from "../../src/core/skills/schema.js";

const SKILL_MD =
  "---\nname: grill-me\ndescription: Ask hard questions.\n---\n\nBody.\n";

describe("discoverLocalSkills", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "local-skills-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(skillDir: string, contents = SKILL_MD) {
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), contents);
  }

  it("treats a directory holding SKILL.md as a single skill", async () => {
    // Given
    await writeSkill(dir);
    await mkdir(join(dir, "references"), { recursive: true });
    await writeFile(join(dir, "references", "api.md"), "# Reference\n");

    // When
    const skills = await discoverLocalSkills(dir);

    // Then
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("grill-me");
    expect(skills[0]?.description).toBe("Ask hard questions.");
    expect(skills[0]?.files.map((file) => file.relativePath)).toEqual([
      "SKILL.md",
      "references/api.md",
    ]);
  });

  it("scans one level of subdirectories when there is no root SKILL.md", async () => {
    // Given — two skills plus a directory that is not one
    await writeSkill(join(dir, "grill-me"));
    await writeSkill(join(dir, "tidy-up"));
    await mkdir(join(dir, "not-a-skill"), { recursive: true });
    await writeFile(join(dir, "not-a-skill", "README.md"), "nope\n");

    // When
    const skills = await discoverLocalSkills(dir);

    // Then — only the qualifying directories, in sorted order
    expect(skills.map((skill) => skill.dirName)).toEqual([
      "grill-me",
      "tidy-up",
    ]);
  });

  it("does not descend past the first level of subdirectories", async () => {
    // Given — the SKILL.md is two levels down
    await writeSkill(join(dir, "nested", "grill-me"));

    // When / Then
    await expect(discoverLocalSkills(dir)).rejects.toThrow(InvalidInputError);
  });

  it("uses the directory name as the skill identity, not the frontmatter name", async () => {
    // Given — frontmatter name deliberately disagrees with the directory
    await writeSkill(join(dir, "on-disk-name"));

    // When
    const skills = await discoverLocalSkills(dir);

    // Then
    expect(skills[0]?.dirName).toBe("on-disk-name");
    expect(skills[0]?.name).toBe("grill-me");
  });

  it("tolerates a SKILL.md with no frontmatter", async () => {
    // Given
    await writeSkill(join(dir, "bare"), "Just a body, no frontmatter.\n");

    // When
    const skills = await discoverLocalSkills(dir);

    // Then
    expect(skills[0]).toMatchObject({
      dirName: "bare",
      name: "",
      description: "",
    });
  });

  it("ignores node_modules and dotfiles inside a skill", async () => {
    // Given
    await writeSkill(dir);
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "node_modules", "pkg", "index.js"), "module\n");
    await writeFile(join(dir, ".DS_Store"), "junk\n");

    // When
    const skills = await discoverLocalSkills(dir);

    // Then
    expect(skills[0]?.files.map((file) => file.relativePath)).toEqual([
      "SKILL.md",
    ]);
  });

  it("does not follow a symlinked directory out of the skill", async () => {
    // Given — a link inside the skill pointing at an unrelated local directory
    await writeSkill(dir);
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "not yours\n");
      await symlink(outside, join(dir, "escape"), "dir");

      // When
      const skills = await discoverLocalSkills(dir);

      // Then — the linked file is never collected
      expect(skills[0]?.files.map((file) => file.relativePath)).toEqual([
        "SKILL.md",
      ]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not follow a symlinked file out of the skill", async () => {
    // Given
    await writeSkill(dir);
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    try {
      const secret = join(outside, "secret.txt");
      await writeFile(secret, "not yours\n");
      await symlink(secret, join(dir, "secret.txt"));

      // When
      const skills = await discoverLocalSkills(dir);

      // Then
      expect(skills[0]?.files.map((file) => file.relativePath)).toEqual([
        "SKILL.md",
      ]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked SKILL.md at the root rather than shipping a skill without it", async () => {
    // Given — the marker reads fine but would be excluded from the copy
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    try {
      await writeFile(join(outside, "real.md"), SKILL_MD);
      await symlink(join(outside, "real.md"), join(dir, "SKILL.md"));

      // When / Then
      await expect(discoverLocalSkills(dir)).rejects.toThrow(
        /SKILL\.md must be a regular file \(found a symlink\)/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked SKILL.md in a subdirectory", async () => {
    // Given
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    try {
      await writeFile(join(outside, "real.md"), SKILL_MD);
      await mkdir(join(dir, "grill-me"), { recursive: true });
      await symlink(
        join(outside, "real.md"),
        join(dir, "grill-me", "SKILL.md"),
      );

      // When / Then
      await expect(discoverLocalSkills(dir)).rejects.toThrow(
        /must be a regular file/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a directory named SKILL.md", async () => {
    // Given
    await mkdir(join(dir, "SKILL.md"), { recursive: true });

    // When / Then
    await expect(discoverLocalSkills(dir)).rejects.toThrow(
      /must be a regular file \(found a directory\)/,
    );
  });

  it("rejects a missing path", async () => {
    await expect(
      discoverLocalSkills(join(dir, "does-not-exist")),
    ).rejects.toThrow(/Directory not found/);
  });

  it("rejects a file path", async () => {
    // Given
    const filePath = join(dir, "SKILL.md");
    await writeFile(filePath, SKILL_MD);

    // When / Then
    await expect(discoverLocalSkills(filePath)).rejects.toThrow(
      /Not a directory/,
    );
  });

  it("explains when no SKILL.md exists at either level", async () => {
    // Given
    await writeFile(join(dir, "README.md"), "no skills here\n");

    // When / Then
    await expect(discoverLocalSkills(dir)).rejects.toThrow(/No skills found/);
  });
});

describe("skill path safety", () => {
  it("rejects directory names that could escape the destination", () => {
    for (const name of ["", ".", "..", "a/b", "a\\b"]) {
      expect(() => assertSafeDirName(name)).toThrow(InvalidInputError);
    }
  });

  it("accepts ordinary directory names", () => {
    expect(() => assertSafeDirName("grill-me")).not.toThrow();
  });

  it("rejects relative paths that climb out of the skill directory", () => {
    for (const path of ["", "../secrets", "a/../../b", "/etc/passwd"]) {
      expect(() => assertSafeRelativePath(path, "grill-me")).toThrow(
        InvalidInputError,
      );
    }
  });

  it("accepts ordinary nested paths", () => {
    expect(() =>
      assertSafeRelativePath("references/api.md", "grill-me"),
    ).not.toThrow();
  });

  it("rejects resolved paths that land outside the skill root", () => {
    expect(() =>
      assertWithinSkillRoot("/skills/grill-me", "/etc/passwd", "grill-me"),
    ).toThrow(InvalidInputError);
    // The root itself is not a file inside the skill.
    expect(() =>
      assertWithinSkillRoot("/skills/grill-me", "/skills/grill-me", "grill-me"),
    ).toThrow(InvalidInputError);
  });

  it("accepts resolved paths beneath the skill root", () => {
    expect(() =>
      assertWithinSkillRoot(
        "/skills/grill-me",
        "/skills/grill-me/references/api.md",
        "grill-me",
      ),
    ).not.toThrow();
  });
});

describe("isBinary", () => {
  it("flags a buffer containing a NUL byte", () => {
    expect(isBinary(Buffer.from([0x50, 0x4e, 0x47, 0x00]))).toBe(true);
  });

  it("passes ordinary text through", () => {
    expect(isBinary(Buffer.from("# Reference\n", "utf-8"))).toBe(false);
  });
});
