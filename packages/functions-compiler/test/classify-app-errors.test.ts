import { describe, expect, it } from "vitest";

import { classifyAppErrors } from "../src/bundler";

describe("classifyAppErrors", () => {
  it("attributes an fn_<index>/ error to that function and strips the prefix", () => {
    const { byIndex, unattributable } = classifyAppErrors([
      { message: "boom", file: "fn_2/main.ts", line: 3 },
    ]);
    expect(unattributable).toEqual([]);
    expect(byIndex.get(2)).toEqual([
      { message: "boom", file: "main.ts", line: 3 },
    ]);
  });

  it("groups multiple errors for the same function", () => {
    const { byIndex } = classifyAppErrors([
      { message: "a", file: "fn_0/x.ts" },
      { message: "b", file: "fn_0/utils/y.ts" },
    ]);
    expect(byIndex.get(0)).toEqual([
      { message: "a", file: "x.ts" },
      { message: "b", file: "utils/y.ts" },
    ]);
  });

  it("treats node_modules and location-less errors as unattributable", () => {
    // These can't be pinned to one function, so the caller falls back to the
    // per-function path rather than dropping the wrong function.
    const { byIndex, unattributable } = classifyAppErrors([
      { message: "dep broke", file: "node_modules/foo/index.js" },
      { message: "no location" },
    ]);
    expect(byIndex.size).toBe(0);
    expect(unattributable).toHaveLength(2);
  });
});
