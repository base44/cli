import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllFunctions } from "@/core/resources/function/config.js";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

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
    expect(fooBar?.entryPath).toContain("foo/bar/entry.ts");

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
    expect(withConfig?.entryPath).toContain("with-config/entry.ts");
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
    expect(result[0].entry).toBe("index.ts");
    expect(result[0].filePaths.length).toBeGreaterThanOrEqual(2); // index.ts, helper.ts (recursive)
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
});
