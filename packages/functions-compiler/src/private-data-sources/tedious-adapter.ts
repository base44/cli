import { isCloudflareTcpSocket } from "./tcp";
import { buildNodeNetSocket } from "./node-net-adapter";

function abortError(label: string, signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`${label} connection aborted`);
}

async function waitForCloudflareTcpSocketOpen(
  socket: unknown,
  label: string,
  signal?: AbortSignal,
) {
  if (!isCloudflareTcpSocket(socket)) {
    throw new Error(`${label} did not return a readable/writable TCP socket`);
  }
  if (!socket.opened) return;

  if (!signal) {
    await socket.opened;
    return;
  }

  if (signal.aborted) {
    try {
      socket.close?.();
    } catch {
      // Best-effort cleanup; surface the abort reason below.
    }
    throw abortError(label, signal);
  }

  let onAbort: (() => void) | null = null;
  try {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        onAbort = () => reject(abortError(label, signal));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch (error) {
    try {
      socket.close?.();
    } catch {
      // Preserve the original connection/abort error.
    }
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function buildTediousNetSocket(socket: unknown) {
  return buildNodeNetSocket(socket, "SQL Server private data source", {
    deferConnectEvent: true,
  });
}

export function buildTediousConnectorFactory(connect: () => unknown) {
  return async (_connectOptions?: unknown, _lookup?: unknown, signal?: AbortSignal) => {
    const socket = connect();
    await waitForCloudflareTcpSocketOpen(socket, "SQL Server private data source", signal);
    return buildTediousNetSocket(socket);
  };
}
