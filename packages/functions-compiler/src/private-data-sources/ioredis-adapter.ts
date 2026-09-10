import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

import { isCloudflareTcpSocket } from "./tcp";

type IoredisErrorEmitter = (type: string, err: Error) => void;

interface IoredisNetStream extends EventEmitter {
  connecting: boolean;
  destroyed: boolean;
  readable: boolean;
  writable: boolean;
  remoteAddress?: string;
  remotePort?: number;
  _writableState: { ended: boolean };
  write(data: string | Uint8Array, callback?: (err?: Error | null) => void): boolean;
  end(data?: string | Uint8Array | (() => void), callback?: () => void): IoredisNetStream;
  destroy(error?: Error): IoredisNetStream;
  setNoDelay(noDelay?: boolean): IoredisNetStream;
  setKeepAlive(enable?: boolean, initialDelay?: number): IoredisNetStream;
  setTimeout(timeout: number, callback?: () => void): IoredisNetStream;
  resume(): IoredisNetStream;
  pause(): IoredisNetStream;
}

function exactNodeBuffer(value: Uint8Array): Buffer {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return Buffer.from(bytes.buffer);
}

function buildIoredisNetStream(
  socket: unknown,
  errorEmitter?: IoredisErrorEmitter,
): IoredisNetStream {
  if (!isCloudflareTcpSocket(socket)) {
    throw new Error("Redis private data source did not return a readable/writable TCP socket");
  }
  const cloudflareSocket = socket;

  const encoder = new TextEncoder();
  const stream = new EventEmitter() as IoredisNetStream;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let readStarted = false;
  let connectEmitted = false;
  let closed = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let writeChain = Promise.resolve();

  function setClosed() {
    if (closed) return;
    closed = true;
    stream.destroyed = true;
    stream.readable = false;
    stream.writable = false;
    stream._writableState.ended = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
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
    stream.emit("close");
  }

  function emitError(error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    errorEmitter?.("error", err);
    stream.emit("error", err);
  }

  function markConnected() {
    if (closed || connectEmitted) return;
    connectEmitted = true;
    stream.connecting = false;
    stream.emit("connect");
  }

  async function readLoop() {
    const activeReader = reader ?? cloudflareSocket.readable.getReader();
    reader = activeReader;
    try {
      while (!closed) {
        const { value, done } = await activeReader.read();
        if (done) break;
        if (value) stream.emit("data", exactNodeBuffer(value));
      }
      setClosed();
    } catch (error) {
      if (!closed) {
        emitError(error);
        setClosed();
      }
    }
  }

  function writeBytes(bytes: Uint8Array) {
    if (closed) return Promise.reject(new Error("Redis connection is closed"));
    const activeWriter = writer ?? cloudflareSocket.writable.getWriter();
    writer = activeWriter;
    return activeWriter.write(bytes);
  }

  stream.connecting = true;
  stream.destroyed = false;
  stream.readable = true;
  stream.writable = true;
  stream._writableState = { ended: false };
  stream.write = (data, callback) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    writeChain = writeChain
      .then(() => writeBytes(bytes))
      .then(
        () => callback?.(),
        (error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          callback?.(err);
          emitError(err);
        },
      );
    return true;
  };
  stream.end = (data?: string | Uint8Array | (() => void), callback?: () => void) => {
    const done = typeof data === "function" ? data : callback;
    if (typeof data === "string" || data instanceof Uint8Array) {
      stream.write(data);
    }
    writeChain
      .finally(() => {
        done?.();
        try {
          cloudflareSocket.close?.();
        } finally {
          setClosed();
        }
      })
      .catch(() => {});
    return stream;
  };
  stream.destroy = (error?: Error) => {
    if (error) emitError(error);
    try {
      cloudflareSocket.close?.();
    } finally {
      setClosed();
    }
    return stream;
  };
  stream.setNoDelay = () => stream;
  stream.setKeepAlive = () => stream;
  stream.setTimeout = (duration, callback) => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    if (duration > 0) {
      timeout = setTimeout(() => {
        callback?.();
        stream.emit("timeout");
      }, duration);
    }
    return stream;
  };
  stream.resume = () => {
    if (!readStarted) {
      readStarted = true;
      readLoop();
    }
    return stream;
  };
  stream.pause = () => stream;

  if (cloudflareSocket.opened) {
    cloudflareSocket.opened.then(markConnected, (error) => {
      emitError(error);
      stream.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  } else {
    queueMicrotask(markConnected);
  }
  cloudflareSocket.closed?.finally(setClosed).catch(() => {});
  return stream;
}

export function buildIoredisConnectorFactory(connect: () => unknown) {
  return class Base44IoredisConnector {
    firstError?: Error;
    private stream?: IoredisNetStream;
    private disconnectTimeout: number;

    constructor(options?: { disconnectTimeout?: number }) {
      this.disconnectTimeout =
        typeof options?.disconnectTimeout === "number" ? options.disconnectTimeout : 2000;
    }

    check() {
      return true;
    }

    connect(errorEmitter?: IoredisErrorEmitter) {
      return Promise.resolve(connect()).then((socket) => {
        try {
          this.stream = buildIoredisNetStream(socket, errorEmitter);
          return this.stream;
        } catch (error) {
          this.firstError = error instanceof Error ? error : new Error(String(error));
          throw this.firstError;
        }
      });
    }

    disconnect() {
      const stream = this.stream;
      if (!stream || stream.destroyed) return;
      const timeout = setTimeout(() => stream.destroy(), this.disconnectTimeout);
      stream.once("close", () => clearTimeout(timeout));
      stream.end();
    }
  };
}
