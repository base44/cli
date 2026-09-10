import { describe, expect, it, vi } from "vitest";

vi.mock("../src/private-data-sources/tcp", () => ({
  isCloudflareTcpSocket: (value: unknown) => value !== null && typeof value === "object",
}));

import { buildIoredisConnectorFactory } from "../src/private-data-sources/ioredis-adapter";

function socket() {
  return {
    readable: new ReadableStream(),
    writable: new WritableStream(),
    opened: Promise.resolve(),
    closed: new Promise<void>(() => {}),
    close: vi.fn(),
  };
}

describe("ioredis adapter", () => {
  it("awaits an authenticated socket before exposing the stream", async () => {
    const authenticatedSocket = socket();
    let resolveSocket: (value: ReturnType<typeof socket>) => void = () => {};
    const pendingSocket = new Promise<ReturnType<typeof socket>>((resolve) => {
      resolveSocket = resolve;
    });
    const Connector = buildIoredisConnectorFactory(() => pendingSocket);
    const connection = new Connector().connect();

    let settled = false;
    void connection.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSocket(authenticatedSocket);
    await expect(connection).resolves.toMatchObject({ writable: true });
  });
});
