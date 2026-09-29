import { describe, expect, it } from "vitest";
import { InvalidInputError } from "../../src/core/errors.js";
import {
  hasExecEnvTarget,
  readExecEnvTarget,
} from "../../src/core/exec/env-target.js";

const TOKEN = "secret-app-token";
const URL_ = "https://sandbox.example.com";

describe("readExecEnvTarget", () => {
  it("returns undefined when no BASE44_EXEC_* variable is set", () => {
    expect(readExecEnvTarget({})).toBeUndefined();
    expect(hasExecEnvTarget({ BASE44_EXEC_ACCESS_TOKEN: "  " })).toBe(false);
  });

  it("reads the token and server URL when both are set", () => {
    const target = readExecEnvTarget({
      BASE44_EXEC_ACCESS_TOKEN: TOKEN,
      BASE44_EXEC_SERVER_URL: URL_,
    });

    expect(target).toEqual({ token: TOKEN, serverUrl: URL_ });
  });

  it("reads the optional service token", () => {
    const target = readExecEnvTarget({
      BASE44_EXEC_ACCESS_TOKEN: TOKEN,
      BASE44_EXEC_SERVER_URL: URL_,
      BASE44_EXEC_SERVICE_TOKEN: "svc",
    });

    expect(target).toEqual({
      token: TOKEN,
      serverUrl: URL_,
      serviceToken: "svc",
    });
  });

  it.each([
    [{ BASE44_EXEC_ACCESS_TOKEN: TOKEN }, "BASE44_EXEC_SERVER_URL is not set"],
    [{ BASE44_EXEC_SERVER_URL: URL_ }, "BASE44_EXEC_ACCESS_TOKEN is not set"],
    [
      { BASE44_EXEC_SERVICE_TOKEN: "svc" },
      "BASE44_EXEC_ACCESS_TOKEN is not set",
    ],
  ])("fails when only part of the target is set (%o)", (env, message) => {
    expect(hasExecEnvTarget(env)).toBe(true);
    expect(() => readExecEnvTarget(env)).toThrow(InvalidInputError);
    expect(() => readExecEnvTarget(env)).toThrow(message);
  });

  it("fails on an invalid server URL", () => {
    expect(() =>
      readExecEnvTarget({
        BASE44_EXEC_ACCESS_TOKEN: TOKEN,
        BASE44_EXEC_SERVER_URL: "not a url",
      }),
    ).toThrow("BASE44_EXEC_SERVER_URL is not a valid URL.");
  });
});
