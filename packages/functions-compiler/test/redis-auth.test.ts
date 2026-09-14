import { describe, expect, it, vi } from "vitest";

import { authenticateRedisSocketIfNeeded } from "../src/private-data-sources/redis-auth";
import type { CloudflareTcpSocket } from "../src/private-data-sources/types";

function redisSocket(response: string) {
  const writes: string[] = [];
  const close = vi.fn();
  const socket: CloudflareTcpSocket = {
    readable: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(response));
        controller.close();
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        writes.push(new TextDecoder().decode(chunk));
      },
    }),
    opened: Promise.resolve(),
    close,
  };
  return { socket, writes, close };
}

describe("Redis private data source authentication", () => {
  it("authenticates with an ACL username before returning the native socket", async () => {
    const { socket, writes } = redisSocket("+OK\r\n");

    const connected = await authenticateRedisSocketIfNeeded(socket, "app_user", "secret");

    expect(connected).toBe(socket);
    expect(writes).toEqual(["*3\r\n$4\r\nAUTH\r\n$8\r\napp_user\r\n$6\r\nsecret\r\n"]);
  });

  it("authenticates with only a password for requirepass Redis", async () => {
    const { socket, writes } = redisSocket("+OK\r\n");

    await authenticateRedisSocketIfNeeded(socket, undefined, "secret");

    expect(writes).toEqual(["*2\r\n$4\r\nAUTH\r\n$6\r\nsecret\r\n"]);
  });

  it("surfaces Redis authentication failures and closes the socket", async () => {
    const { socket, close } = redisSocket("-WRONGPASS invalid username-password pair\r\n");

    await expect(authenticateRedisSocketIfNeeded(socket, undefined, "wrong")).rejects.toThrow(
      "Redis authentication failed: WRONGPASS invalid username-password pair",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns unauthenticated native sockets unchanged", () => {
    const { socket, writes } = redisSocket("+OK\r\n");

    expect(authenticateRedisSocketIfNeeded(socket, undefined, undefined)).toBe(socket);
    expect(writes).toEqual([]);
  });
});
