import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SchemaValidationError } from "@/core/errors.js";
import { computeSeedHash, readSeedFiles } from "@/core/resources/seed/index.js";

const WITH_SEED_CONFIG = resolve(
  __dirname,
  "../fixtures/with-seed/base44/config.jsonc",
);

describe("seed config", () => {
  describe("readSeedFiles", () => {
    let configDir: string;
    let configPath: string;

    beforeEach(async () => {
      configDir = await mkdtemp(join(tmpdir(), "b44-seed-"));
      configPath = join(configDir, "config.jsonc");
      await writeFile(configPath, JSON.stringify({ name: "Seed Test" }));
    });

    afterEach(async () => {
      await rm(configDir, { recursive: true, force: true });
    });

    const givenSeedFile = async (name: string, content: unknown) => {
      await mkdir(join(configDir, "seed"), { recursive: true });
      await writeFile(
        join(configDir, "seed", name),
        JSON.stringify(content, null, 2),
      );
    };

    it("reads the with-seed fixture project", async () => {
      // When
      const seedData = await readSeedFiles({
        configPath: WITH_SEED_CONFIG,
        seedDir: "seed",
      });

      // Then
      expect(seedData).not.toBeNull();
      expect(seedData?.users?.relPath).toBe("seed/users.jsonc");
      expect(seedData?.users?.users).toHaveLength(2);
      expect(seedData?.fixtures.map((f) => f.baseName)).toEqual([
        "task",
        "team-member",
      ]);
      expect(seedData?.scriptPath).toBeNull();
      expect(seedData?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("applies defaults to seed users", async () => {
      // When
      const seedData = await readSeedFiles({
        configPath: WITH_SEED_CONFIG,
        seedDir: "seed",
      });

      // Then — member@seed.dev has no explicit role
      const member = seedData?.users?.users.find(
        (u) => u.email === "member@seed.dev",
      );
      expect(member?.role).toBe("user");
    });

    it("returns null when the project has no seed files", async () => {
      // When
      const seedData = await readSeedFiles({ configPath, seedDir: "seed" });

      // Then
      expect(seedData).toBeNull();
    });

    it("treats Users.jsonc as the users fixture regardless of case", async () => {
      // Given
      await givenSeedFile("Users.jsonc", [{ email: "case@example.com" }]);

      // When
      const seedData = await readSeedFiles({ configPath, seedDir: "seed" });

      // Then
      expect(seedData?.users?.users[0]?.email).toBe("case@example.com");
      expect(seedData?.fixtures).toEqual([]);
    });

    it("throws SchemaValidationError citing the file for a malformed users fixture", async () => {
      // Given — missing required email
      await givenSeedFile("users.jsonc", [{ role: "admin" }]);

      // When / Then
      await expect(
        readSeedFiles({ configPath, seedDir: "seed" }),
      ).rejects.toThrow(SchemaValidationError);
      await expect(
        readSeedFiles({ configPath, seedDir: "seed" }),
      ).rejects.toThrow(/users\.jsonc/);
    });

    it("throws SchemaValidationError when a fixture is not an array", async () => {
      // Given
      await givenSeedFile("task.jsonc", { title: "not an array" });

      // When / Then
      await expect(
        readSeedFiles({ configPath, seedDir: "seed" }),
      ).rejects.toThrow(/task\.jsonc/);
    });

    it("resolves seedDir relative to the config dir", async () => {
      // Given
      await mkdir(join(configDir, "custom-seed"), { recursive: true });
      await writeFile(
        join(configDir, "custom-seed", "users.jsonc"),
        JSON.stringify([{ email: "custom@example.com" }]),
      );

      // When
      const seedData = await readSeedFiles({
        configPath,
        seedDir: "custom-seed",
      });

      // Then
      expect(seedData?.users?.relPath).toBe("custom-seed/users.jsonc");
    });

    it("includes seed.ts in the hash when present", async () => {
      // Given
      await givenSeedFile("users.jsonc", [{ email: "hash@example.com" }]);
      const before = await readSeedFiles({ configPath, seedDir: "seed" });
      await writeFile(join(configDir, "seed.ts"), "export default () => {};");

      // When
      const after = await readSeedFiles({ configPath, seedDir: "seed" });

      // Then
      expect(after?.scriptPath).toBe(join(configDir, "seed.ts"));
      expect(after?.hash).not.toBe(before?.hash);
    });
  });

  describe("computeSeedHash", () => {
    const entry = (relPath: string, content: string) => ({
      relPath,
      bytes: new TextEncoder().encode(content),
    });

    it("is independent of entry order", () => {
      // Given
      const a = entry("seed/a.jsonc", "[]");
      const b = entry("seed/b.jsonc", "[1]");

      // Then
      expect(computeSeedHash([a, b])).toBe(computeSeedHash([b, a]));
    });

    it("changes when file bytes change", () => {
      // Then
      expect(computeSeedHash([entry("seed/a.jsonc", "[]")])).not.toBe(
        computeSeedHash([entry("seed/a.jsonc", "[2]")]),
      );
    });

    it("changes when a file is renamed", () => {
      // Then
      expect(computeSeedHash([entry("seed/a.jsonc", "[]")])).not.toBe(
        computeSeedHash([entry("seed/b.jsonc", "[]")]),
      );
    });
  });
});
