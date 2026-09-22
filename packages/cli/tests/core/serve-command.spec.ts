import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVE_COMMAND,
  forwardsServeAddress,
  withServeAddress,
} from "@/core/site/serve-command.js";

describe("DEFAULT_SERVE_COMMAND", () => {
  it("can take a bind address", () => {
    // What `site dev` falls back to, so it has to be a command that accepts one.
    expect(forwardsServeAddress(DEFAULT_SERVE_COMMAND)).toBe(true);
  });
});

describe("withServeAddress", () => {
  it("appends the address to an npm script through --", () => {
    expect(
      withServeAddress("npm run dev", {
        host: "0.0.0.0",
        port: 5173,
        hostFlag: "--host",
      }),
    ).toBe("npm run dev -- --host 0.0.0.0 --port 5173");
  });

  it("uses the project's own spelling of the host flag", () => {
    // Next exits on --host.
    expect(
      withServeAddress("npm run dev", {
        host: "0.0.0.0",
        hostFlag: "--hostname",
      }),
    ).toBe("npm run dev -- --hostname 0.0.0.0");
  });

  it("appends a prefixed npm script too", () => {
    expect(
      withServeAddress("npm --prefix site run dev", {
        port: 4173,
        hostFlag: "--host",
      }),
    ).toBe("npm --prefix site run dev -- --port 4173");
  });

  it("leaves the command alone when there is no address to add", () => {
    expect(withServeAddress("npm run dev", { hostFlag: "--host" })).toBe(
      "npm run dev",
    );
  });

  it("leaves a command that cannot forward arguments alone", () => {
    // `vite -- --host` would read the -- as vite's own argument.
    expect(
      withServeAddress("vite", { host: "0.0.0.0", hostFlag: "--host" }),
    ).toBe("vite");
  });

  it.each([
    "npm run dev",
    "npm --prefix site run dev",
    "  npm run dev  ",
  ])("forwards for %s", (command) => {
    expect(forwardsServeAddress(command)).toBe(true);
  });

  it.each([
    "vite",
    "next dev",
    "npm run",
    "yarn dev",
    "npm install",
  ])("does not forward for %s", (command) => {
    expect(forwardsServeAddress(command)).toBe(false);
  });
});
