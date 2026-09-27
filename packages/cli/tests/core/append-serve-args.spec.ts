import { describe, expect, it } from "vitest";
import { appendServeArgs } from "@/cli/dev/append-serve-args.js";

describe("appendServeArgs", () => {
  it("leaves the command as written when nothing is forwarded", () => {
    expect(appendServeArgs("npm run dev", [])).toBe("npm run dev");
  });

  it("appends plain arguments bare", () => {
    const command = appendServeArgs(
      "npm run dev",
      ["--", "--config", "/managed/wrapper.mjs"],
      "linux",
    );

    expect(command).toBe("npm run dev -- --config /managed/wrapper.mjs");
  });

  it("quotes what a POSIX shell would split or interpret", () => {
    const command = appendServeArgs(
      "vite",
      ["a b", "x && echo hi", "it's"],
      "linux",
    );

    expect(command).toBe("vite 'a b' 'x && echo hi' 'it'\\''s'");
  });

  it("uses double quotes for cmd.exe", () => {
    expect(appendServeArgs("vite", ['a "b"'], "win32")).toBe(
      'vite "a \\"b\\""',
    );
  });
});
