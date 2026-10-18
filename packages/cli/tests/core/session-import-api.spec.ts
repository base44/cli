import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("importSession", () => {
  let server: Server;

  beforeEach(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.statusCode = 422;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ detail: "invalid" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    vi.stubEnv(
      "BASE44_API_URL",
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise((resolve) => server.close(resolve));
  });

  it("leaves the conversation out of the error that error reporting sends", async () => {
    const { setAppContext } = await import("@/core/project/index.js");
    const { importSession } = await import("@/core/session-import/api.js");
    const { ApiError } = await import("@/core/errors.js");
    setAppContext({ id: "app-1" });

    const failure = await importSession({
      source: "claude_code",
      sessionId: "s1",
      title: "t",
      turns: [{ role: "user", text: "the secret plan" }],
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as InstanceType<typeof ApiError>).statusCode).toBe(422);
    expect(
      (failure as InstanceType<typeof ApiError>).requestBody,
    ).toBeUndefined();
  });
});
