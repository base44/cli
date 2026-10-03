import { once } from "node:events";
import net from "node:net";

import { describe, expect, it, vi } from "vitest";

import { oracle } from "../src/private-data-sources/oracle";
import { runWithWorkerEnvironment } from "../src/runtime-context";

function withSource<T>(bindingName: string, password: string, connect: () => unknown, callback: () => T) {
  const env = {
    BASE44_PRIVATE_DATA_SOURCES: JSON.stringify([{
      name: "Oracle", type: "oracle", bindingName, host: `${bindingName}.internal`,
      port: 1521, database: "FREEPDB1", username: "app_user", password,
    }]),
    [bindingName]: { connect },
  };
  return runWithWorkerEnvironment({ env: "preview", secrets: env, workerEnv: env, waitUntil() {} }, callback);
}

function fakeSocket() {
  let incoming: ReadableStreamDefaultController<Uint8Array>;
  const writes: Uint8Array[] = [];
  return {
    readable: new ReadableStream<Uint8Array>({ start(controller) { incoming = controller; } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) { writes.push(bytes); } }),
    opened: Promise.resolve(),
    close: vi.fn(),
    writes,
    reply(bytes: Uint8Array) { incoming.enqueue(bytes); },
  };
}

describe("Oracle private connections", () => {
  it("routes bytes through an asynchronously opened VPC socket and closes it", async () => {
    const socket = fakeSocket();
    const connect = vi.fn(async () => socket);
    await withSource("DB", "secret", connect, async () => {
      const options = oracle("Oracle").oracledbOptions();
      const host = options.connectString.match(/\(HOST=([^)]*)\)/)![1];
      expect(net.isIP(host)).toBe(6);
      const stream = net.connect(1521, host);
      await once(stream, "connect");
      const request = Buffer.from([0, 8, 0, 0, 1, 0, 0, 0]);
      await new Promise<void>((resolve, reject) => stream.write(request, (error) => error ? reject(error) : resolve()));
      expect(socket.writes).toEqual([request]);
      const response = once(stream, "data");
      socket.reply(Uint8Array.of(1, 2, 3));
      expect((await response)[0]).toEqual(Buffer.from([1, 2, 3]));
      stream.destroy();
      await once(stream, "close");
      expect(socket.close).toHaveBeenCalledOnce();
    });
    expect(connect).toHaveBeenCalledWith({ hostname: "DB.internal", port: 1521 }, undefined);
  });

  it("resolves credentials and bindings from each overlapping request", async () => {
    const source = oracle("Oracle");
    const sockets = [fakeSocket(), fakeSocket()];
    const connects = sockets.map((socket) => vi.fn(async () => socket));
    const options = await Promise.all(connects.map((connect, index) =>
      withSource(`DB_${index}`, `password_${index}`, connect, async () => {
        const options = source.oracledbOptions();
        await new Promise((resolve) => setTimeout(resolve, 1));
        const host = options.connectString.match(/\(HOST=([^)]*)\)/)![1];
        const stream = net.connect(1521, host);
        await once(stream, "connect");
        stream.destroy();
        await once(stream, "close");
        return options;
      }),
    ));
    expect(options.map((value) => value.password)).toEqual(["password_0", "password_1"]);
    connects.forEach((connect, index) => expect(connect).toHaveBeenCalledWith(
      { hostname: `DB_${index}.internal`, port: 1521 }, undefined,
    ));
  });

  it("surfaces an asynchronous binding failure as a socket error", async () => {
    await withSource("FAILED", "secret", async () => { throw new Error("Tunnel unavailable"); }, async () => {
      const options = oracle("Oracle").oracledbOptions();
      const host = options.connectString.match(/\(HOST=([^)]*)\)/)![1];
      const stream = net.connect(1521, host);
      const [error] = await once(stream, "error");
      expect(error.message).toBe("Tunnel unavailable");
      expect(stream.destroyed).toBe(true);
    });
  });
});
