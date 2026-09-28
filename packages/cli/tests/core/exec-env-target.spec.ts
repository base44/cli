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

  it("reads the optional service token and headers", () => {
    const target = readExecEnvTarget({
      BASE44_EXEC_ACCESS_TOKEN: TOKEN,
      BASE44_EXEC_SERVER_URL: URL_,
      BASE44_EXEC_SERVICE_TOKEN: "svc",
      BASE44_EXEC_HEADERS: '{"X-Branch":"b1","X-Test-DB":"true"}',
    });

    expect(target).toEqual({
      token: TOKEN,
      serverUrl: URL_,
      serviceToken: "svc",
      headers: { "X-Branch": "b1", "X-Test-DB": "true" },
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

  it.each([
    ["{not json", "BASE44_EXEC_HEADERS is not valid JSON."],
    ['["a"]', "BASE44_EXEC_HEADERS must be a JSON object"],
    ['{"X-Count":1}', "BASE44_EXEC_HEADERS must be a JSON object"],
  ])("fails on invalid headers %s without echoing the value", (raw, message) => {
    const read = () =>
      readExecEnvTarget({
        BASE44_EXEC_ACCESS_TOKEN: TOKEN,
        BASE44_EXEC_SERVER_URL: URL_,
        BASE44_EXEC_HEADERS: raw,
      });

    expect(read).toThrow(message);
    try {
      read();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(TOKEN);
      expect(String((error as Error).message)).not.toContain(raw);
    }
  });
});
