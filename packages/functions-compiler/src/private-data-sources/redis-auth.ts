import type { CloudflareTcpSocket } from "./types";

const MAX_AUTH_RESPONSE_BYTES = 4096;

function isCloudflareTcpSocket(socket: unknown): socket is CloudflareTcpSocket {
  const candidate = socket as Partial<CloudflareTcpSocket> | null;
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !!candidate.readable &&
    typeof candidate.readable.getReader === "function" &&
    !!candidate.writable &&
    typeof candidate.writable.getWriter === "function"
  );
}

function encodeRespArray(values: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(`*${values.length}\r\n`)];
  for (const value of values) {
    const bytes = encoder.encode(value);
    chunks.push(encoder.encode(`$${bytes.byteLength}\r\n`), bytes, encoder.encode("\r\n"));
  }
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readResponseLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const bytes: number[] = [];
  while (bytes.length <= MAX_AUTH_RESPONSE_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const byte of value ?? []) {
      bytes.push(byte);
      const length = bytes.length;
      if (length >= 2 && bytes[length - 2] === 13 && bytes[length - 1] === 10) {
        return new TextDecoder().decode(new Uint8Array(bytes.slice(0, -2)));
      }
      if (length > MAX_AUTH_RESPONSE_BYTES) break;
    }
  }
  throw new Error("Redis authentication failed: invalid or missing server response");
}

async function authenticateRedisSocket(
  socket: unknown,
  username: string | undefined,
  password: string,
): Promise<CloudflareTcpSocket> {
  if (!isCloudflareTcpSocket(socket)) {
    throw new Error("Redis private data source did not return a readable/writable TCP socket");
  }
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  try {
    await socket.opened;
    const auth = username ? ["AUTH", username, password] : ["AUTH", password];
    await writer.write(encodeRespArray(auth));
    const response = await readResponseLine(reader);
    if (response === "+OK") return socket;
    const message = response.startsWith("-") ? response.slice(1) : `unexpected response ${JSON.stringify(response)}`;
    throw new Error(`Redis authentication failed: ${message}`);
  } catch (error) {
    socket.close?.();
    throw error;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}

export function authenticateRedisSocketIfNeeded(
  socket: unknown,
  username: string | undefined,
  password: string | undefined,
): unknown | Promise<CloudflareTcpSocket> {
  return password ? authenticateRedisSocket(socket, username, password) : socket;
}
