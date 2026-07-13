import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllFunctions } from "@/core/resources/function/config.js";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

/** Normalize path to forward slashes for cross-platform assertions */
const fwd = (p: string) => p.replace(/\\/g, "/");

describe("readAllFunctions", () => {
  it("returns empty array when functions dir does not exist", async () => {
    const result = await readAllFunctions(
      resolve(FIXTURES_DIR, "nonexistent-functions"),
    );
    expect(result).toEqual([]);
  });

  it("discovers zero-config functions with path-based names", async () => {
    const functionsDir = resolve(FIXTURES_DIR, "function-discovery");
    const result = await readAllFunctions(functionsDir);

    expect(result).toHaveLength(4); // foo/bar, foo/kfir/hello, stam, with-config (config-based)

    const names = result.map((f) => f.name).sort();
    expect(names).toContain("foo/bar");
    expect(names).toContain("foo/kfir/hello");
    expect(names).toContain("stam");
    expect(names).toContain("custom-name");

    const fooBar = result.find((f) => f.name === "foo/bar");
    expect(fooBar).toBeDefined();
    expect(fooBar?.entry).toBe("entry.ts");
    expect(fwd(fooBar!.entryPath)).toContain("foo/bar/entry.ts");

    const stam = result.find((f) => f.name === "stam");
    expect(stam).toBeDefined();
    expect(stam?.entry).toBe("entry.ts");
  });

  it("config wins when function.jsonc exists next to entry.ts", async () => {
    const functionsDir = resolve(FIXTURES_DIR, "function-discovery");
    const result = await readAllFunctions(functionsDir);

    const withConfig = result.find((f) => f.name === "custom-name");
    expect(withConfig).toBeDefined();
    expect(withConfig?.entry).toBe("entry.ts");
    expect(fwd(withConfig!.entryPath)).toContain("with-config/entry.ts");
    // Name comes from config, not path "with-config"
    expect(withConfig?.name).toBe("custom-name");
  });

  it("includes files recursively in filePaths for zero-config functions", async () => {
    const functionsDir = resolve(FIXTURES_DIR, "function-discovery");
    const result = await readAllFunctions(functionsDir);

    const stam = result.find((f) => f.name === "stam");
    expect(stam).toBeDefined();
    expect(stam?.filePaths.length).toBeGreaterThanOrEqual(2); // entry.ts + lib/helper.ts
    const hasEntry = stam?.filePaths.some((p) => p.endsWith("stam/entry.ts"));
    const hasHelper = stam?.filePaths.some((p) =>
      p.replace(/\\/g, "/").endsWith("stam/lib/helper.ts"),
    );
    expect(hasEntry).toBe(true);
    expect(hasHelper).toBe(true);
  });

  it("reads config-based function from with-functions-and-entities fixture", async () => {
    const functionsDir = resolve(
      FIXTURES_DIR,
      "with-functions-and-entities/base44/functions",
    );
    const result = await readAllFunctions(functionsDir);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("process-order");
    expect(result[0].entry).toBe("entry.ts");
    expect(result[0].filePaths.length).toBeGreaterThanOrEqual(2); // entry.ts, helper.ts (recursive)
  });

  it("throws when entry.ts is at functions root (empty name)", async () => {
    const functionsDir = resolve(
      FIXTURES_DIR,
      "function-discovery-entry-at-root",
    );
    await expect(readAllFunctions(functionsDir)).rejects.toThrow(
      /must be inside a named subfolder/,
    );
  });

  it("throws on duplicate function names", async () => {
    const functionsDir = resolve(
      FIXTURES_DIR,
      "duplicate-function-names/base44/functions",
    );
    await expect(readAllFunctions(functionsDir)).rejects.toThrow(
      /Duplicate function name "same-name"/,
    );
  });

  it("uploads base44/shared/ files with every function", async () => {
    const functionsDir = resolve(
      FIXTURES_DIR,
      "function-shared-imports/base44/functions",
    );
    const result = await readAllFunctions(functionsDir);

    expect(result).toHaveLength(3); // greet, farewell, hello-sibling

    for (const fn of result) {
      const hasShared = fn.filePaths.some((p) =>
        fwd(p).endsWith("shared/response.ts"),
      );
      expect(hasShared, `${fn.name} should include shared/response.ts`).toBe(
        true,
      );

      // .jsonc shared files are uploaded too
      const hasJsonc = fn.filePaths.some((p) =>
        fwd(p).endsWith("shared/constants.jsonc"),
      );
      expect(hasJsonc, `${fn.name} should include shared/constants.jsonc`).toBe(
        true,
      );
    }
  });

  it("includes sibling files from the function directory alongside shared", async () => {
    const functionsDir = resolve(
      FIXTURES_DIR,
      "function-shared-imports/base44/functions",
    );
    const result = await readAllFunctions(functionsDir);
    const fn = result.find((f) => f.name === "hello-sibling");
    expect(fn).toBeDefined();

    // util.ts is a same-dir sibling picked up by the function-dir glob
    const hasUtil = fn!.filePaths.some((p) =>
      fwd(p).endsWith("hello-sibling/util.ts"),
    );
    expect(hasUtil, "sibling util.ts should be included").toBe(true);

    // shared/response.ts is included because the whole shared dir is uploaded
    const hasShared = fn!.filePaths.some((p) =>
      fwd(p).endsWith("shared/response.ts"),
    );
    expect(hasShared, "shared/response.ts should be included").toBe(true);
  });

  it("shared file uses the function-dir-relative deploy path", async () => {
    const functionsDir = resolve(
      FIXTURES_DIR,
      "function-shared-imports/base44/functions",
    );
    const result = await readAllFunctions(functionsDir);
    const greet = result.find((f) => f.name === "greet");
    expect(greet).toBeDefined();

    const sharedPath = greet!.filePaths.find((p) =>
      fwd(p).endsWith("shared/response.ts"),
    );
    expect(sharedPath).toBeDefined();

    // deploy.ts uses relative(functionDir, filePath) — verify the expected relative path
    const { dirname: pathDirname, relative: pathRelative } = await import(
      "node:path"
    );
    const rel = fwd(pathRelative(pathDirname(greet!.entryPath), sharedPath!));
    expect(rel).toBe("../../shared/response.ts");
  });
});
