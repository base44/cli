import { Buffer } from "node:buffer";
import nodeNet from "node:net";
import { Duplex } from "node:stream";

import { isCloudflareTcpSocket } from "./tcp";

interface NodeNetSocket extends Duplex {
  connecting: boolean;
  remoteAddress?: string;
  remotePort?: number;
  setNoDelay(noDelay?: boolean): NodeNetSocket;
  setKeepAlive(enable?: boolean, initialDelay?: number): NodeNetSocket;
  setTimeout(timeout: number, callback?: () => void): NodeNetSocket;
}

interface PrivateNodeNetRoute {
  label: string;
  connect: () => unknown;
}

const privateNodeNetRoutes = new Map<string, PrivateNodeNetRoute>();

function exactNodeBuffer(value: Uint8Array): Buffer {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return Buffer.from(bytes.buffer);
}

function nodeNetRouteKey(hostname: string, port: number): string {
  return `${hostname.toLowerCase()}:${port}`;
}

export function registerPrivateNodeNetRoute(hostname: string, port: number, route: PrivateNodeNetRoute) {
  privateNodeNetRoutes.set(nodeNetRouteKey(hostname, port), route);
}

function parseNodeNetCreateConnectionAddress(args: unknown[]) {
  const [first, second] = args;
  if (first && typeof first === "object") {
    const options = first as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown };
    if (typeof options.path === "string") return null;
    const port = typeof options.port === "number" ? options.port : Number(options.port);
    if (!Number.isFinite(port)) return null;
    const hostname =
      typeof options.host === "string"
        ? options.host
        : typeof options.hostname === "string"
          ? options.hostname
          : "localhost";
    return { hostname, port };
  }

  if (typeof first === "number") {
    const hostname = typeof second === "string" ? second : "localhost";
    return { hostname, port: first };
  }

  return null;
}

function parseNodeNetConnectCallback(args: unknown[]): (() => void) | undefined {
  const callback = args.find((arg) => typeof arg === "function");
  return callback as (() => void) | undefined;
}

export function installPrivateNodeNetAdapter() {
  const netModule = nodeNet as typeof nodeNet & {
    __base44PrivateDataSourceAdapterInstalled?: boolean;
  };
  if (netModule.__base44PrivateDataSourceAdapterInstalled) return;

  const originalCreateConnection = netModule.createConnection.bind(netModule);
  const createConnection = (...args: unknown[]) => {
    const address = parseNodeNetCreateConnectionAddress(args);
    const route = address
      ? privateNodeNetRoutes.get(nodeNetRouteKey(address.hostname, address.port))
      : undefined;
    if (!route) {
      return originalCreateConnection(...(args as Parameters<typeof nodeNet.createConnection>));
    }

    const socket = buildNodeNetSocket(route.connect(), route.label);
    const callback = parseNodeNetConnectCallback(args);
    if (callback) socket.once("connect", callback);
    return socket;
  };

  netModule.createConnection = createConnection as typeof nodeNet.createConnection;
  netModule.connect = createConnection as typeof nodeNet.connect;
  netModule.__base44PrivateDataSourceAdapterInstalled = true;
}

export function buildNodeNetSocket(
  socket: unknown,
  label: string,
  options: { deferConnectEvent?: boolean } = {},
): NodeNetSocket {
  if (!isCloudflareTcpSocket(socket)) {
    throw new Error(`${label} did not return a readable/writable TCP socket`);
  }
  const cloudflareSocket = socket;

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let closed = false;
  let connectEmitted = false;
  let readableEnded = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let writeChain = Promise.resolve();

  function clearTimer() {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = null;
  }

  function releaseLocks() {
    try {
      reader?.releaseLock();
    } catch {
      // Ignore release errors when the stream is already closed.
    }
    reader = null;
    try {
      writer?.releaseLock();
    } catch {
      // Ignore release errors when the stream is already closed.
    }
    writer = null;
  }

  function endReadable() {
    if (readableEnded) return;
    readableEnded = true;
    stream.push(null);
  }

  const stream = new Duplex({
    read() {
      // Data is pushed from the Cloudflare readable stream below.
    },
    write(chunk, _encoding, callback) {
      const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      writeChain = writeChain
        .then(async () => {
          if (closed) throw new Error(`${label} connection is closed`);
          const activeWriter = writer ?? cloudflareSocket.writable.getWriter();
          writer = activeWriter;
          await activeWriter.write(bytes);
        })
        .then(
          () => callback(),
          (error) => callback(error instanceof Error ? error : new Error(String(error))),
        );
    },
    final(callback) {
      writeChain
        .then(() => {
          try {
            cloudflareSocket.close?.();
          } finally {
            callback();
          }
        })
        .catch((error) => callback(error instanceof Error ? error : new Error(String(error))));
    },
    destroy(error, callback) {
      closed = true;
      clearTimer();
      try {
        cloudflareSocket.close?.();
      } catch {
        // The stream is already being destroyed; surface the original error below.
      }
      releaseLocks();
      callback(error);
    },
  }) as NodeNetSocket;

  stream.connecting = true;
  stream.setNoDelay = () => stream;
  stream.setKeepAlive = () => stream;
  stream.setTimeout = (duration, callback) => {
    clearTimer();
    if (duration > 0) {
      timeout = setTimeout(() => {
        callback?.();
        stream.emit("timeout");
      }, duration);
    }
    return stream;
  };

  async function readLoop() {
    const activeReader = reader ?? cloudflareSocket.readable.getReader();
    reader = activeReader;
    try {
      while (!closed) {
        const { value, done } = await activeReader.read();
        if (done) break;
        if (value) stream.push(exactNodeBuffer(value));
      }
      endReadable();
      releaseLocks();
    } catch (error) {
      if (!closed) stream.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function markConnected(info?: unknown) {
    if (closed || connectEmitted) return;
    connectEmitted = true;
    const socketInfo = info as { remoteAddress?: unknown; remotePort?: unknown } | null;
    if (typeof socketInfo?.remoteAddress === "string") stream.remoteAddress = socketInfo.remoteAddress;
    if (typeof socketInfo?.remotePort === "number") stream.remotePort = socketInfo.remotePort;
    stream.connecting = false;
    stream.emit("connect");
    readLoop();
  }

  function scheduleConnected(info?: unknown) {
    if (options.deferConnectEvent) {
      setTimeout(() => markConnected(info), 0);
    } else {
      markConnected(info);
    }
  }

  if (cloudflareSocket.opened) {
    cloudflareSocket.opened.then(
      (info) => scheduleConnected(info),
      (error) => stream.destroy(error instanceof Error ? error : new Error(String(error))),
    );
  } else {
    queueMicrotask(() => scheduleConnected());
  }
  cloudflareSocket.closed?.finally(() => {
    closed = true;
    clearTimer();
    endReadable();
    releaseLocks();
  }).catch((error) => stream.destroy(error instanceof Error ? error : new Error(String(error))));
  return stream;
}
