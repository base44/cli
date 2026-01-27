import { describe, it, expect } from "vitest";
import { readProjectConfig } from "@/core/project/index.js";
import { resolve } from "path";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

describe("readProjectConfig", () => {
  // Success cases
  it("reads basic project config", async () => {
    const result = await readProjectConfig(resolve(FIXTURES_DIR, "basic"));

    expect(result.project.name).toBe("Basic Test Project");
    expect(result.entities).toEqual([]);
    expect(result.functions).toEqual([]);
  });

  it("reads project with entities", async () => {
    const result = await readProjectConfig(
      resolve(FIXTURES_DIR, "with-entities")
    );

    expect(result.entities).toHaveLength(2);
    expect(result.entities.map((e) => e.name)).toContain("User");
    expect(result.entities.map((e) => e.name)).toContain("Product");
    expect(result.functions).toEqual([]);
  });

  it("reads project with functions and entities", async () => {
    const result = await readProjectConfig(
      resolve(FIXTURES_DIR, "with-functions-and-entities")
    );

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("Order");
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("process-order");
    expect(result.functions[0].entry).toBe("index.ts");
  });

  it("reads project with mixed functions (with and without config files)", async () => {
    const result = await readProjectConfig(
      resolve(FIXTURES_DIR, "with-mixed-functions")
    );

    expect(result.functions).toHaveLength(3);

    const functionNames = result.functions.map((f) => f.name).sort();
    expect(functionNames).toEqual(["my-complex-func", "my-func", "other-func"]);

    // Check function with config file
    const myFunc = result.functions.find((f) => f.name === "my-func");
    expect(myFunc).toBeDefined();
    expect(myFunc?.entry).toBe("index.ts");

    // Check auto-detected function
    const otherFunc = result.functions.find((f) => f.name === "other-func");
    expect(otherFunc).toBeDefined();
    expect(otherFunc?.entry).toBe("index.ts");

    // Check auto-detected function with kebab-cased name
    const myComplexFunc = result.functions.find((f) => f.name === "my-complex-func");
    expect(myComplexFunc).toBeDefined();
    expect(myComplexFunc?.entry).toBe("index.ts");
  });

  // Error cases
  it("throws when no config file exists", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "no-config"))
    ).rejects.toThrow(/Project root not found/);
  });

  it("throws on invalid JSON syntax", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "invalid-json"))
    ).rejects.toThrow();
  });

  it("throws on invalid config schema", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "invalid-config-schema"))
    ).rejects.toThrow(/Invalid project configuration/);
  });

  it("throws on invalid entity file", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "invalid-entity"))
    ).rejects.toThrow(/Invalid entity configuration/);
  });
});
