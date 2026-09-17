/**
 * The banner carries this package's version, so the literal in src/version.ts
 * is part of every compiled shard's bytes. If it drifts from package.json, the
 * artifacts claim a version that was never published.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COMPILER_VERSION } from "../src/version";

describe("COMPILER_VERSION", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(COMPILER_VERSION).toBe(pkg.version);
  });
});
