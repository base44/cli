import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVE_COMMAND,
  withServeAddress,
} from "@/core/site/serve-command.js";

const ADDRESS = { host: "0.0.0.0", port: 5173, hostFlag: "--host" };

describe("withServeAddress", () => {
  it("appends the address to an npm script through --", () => {
    expect(withServeAddress("npm run dev", ADDRESS)).toEqual({
      command: "npm run dev -- --host 0.0.0.0 --port 5173",
      droppedAddress: false,
    });
  });

  it("appends to pnpm, yarn and bun without the -- npm needs", () => {
    // Those three pass anything after the script name straight through; npm
    // consumes it itself.
    for (const runner of [
      "pnpm dev",
      "pnpm run dev",
      "yarn dev",
      "bun run dev",
    ]) {
      expect(withServeAddress(runner, ADDRESS).command).toBe(
        `${runner} --host 0.0.0.0 --port 5173`,
      );
    }
  });

  it("uses the project's own spelling of the host flag", () => {
    // Next exits on --host.
    expect(
      withServeAddress("npm run dev", {
        host: "0.0.0.0",
        port: 5173,
        hostFlag: "--hostname",
      }).command,
    ).toBe("npm run dev -- --hostname 0.0.0.0 --port 5173");
  });

  it("appends a prefixed npm script too", () => {
    expect(
      withServeAddress("npm --prefix site run dev", {
        host: "0.0.0.0",
        port: 4173,
        hostFlag: "--host",
      }).command,
    ).toBe("npm --prefix site run dev -- --host 0.0.0.0 --port 4173");
  });

  it("trims the command it composes, not just the one it tests", () => {
    expect(withServeAddress("  npm run dev  ", ADDRESS).command).toBe(
      "npm run dev -- --host 0.0.0.0 --port 5173",
    );
  });

  it("can take the address on the command site dev falls back to", () => {
    expect(
      withServeAddress(DEFAULT_SERVE_COMMAND, ADDRESS).droppedAddress,
    ).toBe(false);
  });

  it.each([
    // `vite -- --host` would read the -- as vite's own argument.
    "vite",
    "next dev",
    "npm run",
    // Already pins an address of its own; appending would send two.
    "npm run dev -- --port 3000",
    "npm run build && npm run dev",
  ])("reports the address as dropped for %s", (command) => {
    expect(withServeAddress(command, ADDRESS)).toEqual({
      command,
      droppedAddress: true,
    });
  });

  it.each([
    // A `\S+` script token would match all of these and hand the address to the
    // second command instead of the dev server.
    "npm run dev;evil",
    "npm run dev&&evil",
    "npm run dev|evil",
    "npm run $(id)",
    "npm --prefix $(id) run dev",
  ])("does not treat %s as a forwarding shape", (command) => {
    expect(withServeAddress(command, ADDRESS).droppedAddress).toBe(true);
  });
});
