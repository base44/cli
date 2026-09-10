import { describe, expect, it, vi } from "vitest";

import { http } from "../src/private-data-sources/http";
import { postgres } from "../src/private-data-sources/postgres";
import { sqlserver } from "../src/private-data-sources/sqlserver";
import { runWithWorkerEnvironment } from "../src/runtime-context";

type WorkerEnv = Record<string, unknown>;

function withEnvironment<T>(env: WorkerEnv, callback: () => T): T {
  return runWithWorkerEnvironment(
    {
      env: "preview",
      secrets: env,
      workerEnv: env,
      waitUntil() {},
    },
    callback,
  );
}

function manifest(
  type: string,
  bindingName: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify([
    {
      name: "Primary",
      type,
      bindingName,
      ...extra,
    },
  ]);
}

describe("request-scoped private data source bindings", () => {
  it("uses the current HTTP binding and manifest for every fetch", async () => {
    const fetchA = vi.fn(
      async (request: RequestInfo | URL) =>
        new Response(`a:${String(request)}`),
    );
    const fetchB = vi.fn(
      async (request: RequestInfo | URL) =>
        new Response(`b:${String(request)}`),
    );
    const envA = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("http", "HTTP_A", {
        baseUrl: "https://a.internal",
      }),
      HTTP_A: { fetch: fetchA },
    };
    const envB = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("http", "HTTP_B", {
        baseUrl: "https://b.internal",
      }),
      HTTP_B: { fetch: fetchB },
    };
    const source = http("Primary");

    await withEnvironment(envA, () => source.fetch("/health"));
    await withEnvironment(envB, () => source.fetch("/health"));

    expect(fetchA).toHaveBeenCalledWith(
      "https://a.internal/health",
      undefined,
    );
    expect(fetchB).toHaveBeenCalledWith(
      "https://b.internal/health",
      undefined,
    );
  });

  it("resolves a deferred HTTP raw binding from the current manifest", () => {
    const source = http("Primary");
    const fixedBinding = { fetch: vi.fn() };
    const fixedEnv = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("http", "HTTP_FIXED"),
      HTTP_FIXED: fixedBinding,
    };
    const networkEnv = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("http", "HTTP_NETWORK", {
        networkScope: "network",
      }),
      HTTP_NETWORK: { fetch: vi.fn() },
    };

    expect(withEnvironment(fixedEnv, () => source.binding)).toBe(fixedBinding);
    expect(withEnvironment(networkEnv, () => source.binding)).toBeUndefined();
  });

  it("uses the current TCP binding for every connection", () => {
    const connectA = vi.fn(() => "socket-a");
    const connectB = vi.fn(() => "socket-b");
    const envA = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("sqlserver", "TCP_A", {
        host: "db-a.internal",
        port: 1433,
      }),
      TCP_A: { connect: connectA },
    };
    const envB = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("sqlserver", "TCP_B", {
        host: "db-b.internal",
        port: 1434,
      }),
      TCP_B: { connect: connectB },
    };
    const source = sqlserver("Primary");

    expect(withEnvironment(envA, () => source.connect())).toBe("socket-a");
    expect(withEnvironment(envB, () => source.connect())).toBe("socket-b");
    expect(connectA).toHaveBeenCalledWith(
      { hostname: "db-a.internal", port: 1433 },
      undefined,
    );
    expect(connectB).toHaveBeenCalledWith(
      { hostname: "db-b.internal", port: 1434 },
      undefined,
    );
  });

  it("reads Hyperdrive properties from the current request binding", () => {
    const envA = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("postgres", "PG_A"),
      PG_A: { connectionString: "postgres://a" },
    };
    const envB = {
      BASE44_PRIVATE_DATA_SOURCES: manifest("postgres", "PG_B"),
      PG_B: { connectionString: "postgres://b" },
    };
    const source = postgres("Primary");

    expect(
      withEnvironment(envA, () => source.connectionString),
    ).toBe("postgres://a");
    expect(
      withEnvironment(envB, () => source.connectionString),
    ).toBe("postgres://b");
  });
});
