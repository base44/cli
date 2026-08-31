import { z } from "zod";
import {
  getWorkspaceApiKeyFromEnv,
  isTokenExpired,
  isWorkspaceApiKey,
  readAuth,
  refreshAndSaveTokens,
} from "@/core/auth/config.js";
import { getBase44ApiUrl } from "@/core/config.js";
import { getAppContext } from "@/core/project/index.js";
import {
  type LogEnv,
  LogLevelSchema,
} from "@/core/resources/function/schema.js";

export const StreamLogEventSchema = z.object({
  time: z.string(),
  level: z.preprocess(
    (value) => (value === "warn" ? "warning" : value),
    LogLevelSchema,
  ),
  function: z.string().nullable(),
  message: z.string(),
});

export type StreamLogEvent = z.infer<typeof StreamLogEventSchema>;

const StreamEndEventSchema = z.object({
  reason: z.string(),
  retriable: z.boolean(),
});

export type StreamEndEvent = z.infer<typeof StreamEndEventSchema>;

export type StreamEvent =
  | { kind: "log"; log: StreamLogEvent }
  | { kind: "end"; end: StreamEndEvent }
  | { kind: "ping" };

export interface LogStreamFilters {
  functions?: string[];
  env?: LogEnv;
}

function buildStreamUrl(filters: LogStreamFilters): string {
  const { id } = getAppContext();
  const url = new URL(
    `/api/apps/${id}/functions-mgmt/logs/stream`,
    getBase44ApiUrl(),
  );
  if (filters.functions?.length) {
    url.searchParams.set("function", filters.functions.join(","));
  }
  if (filters.env) {
    url.searchParams.set("env", filters.env);
  }
  return url.href;
}

async function buildStreamAuthHeaders(): Promise<Record<string, string>> {
  const workspaceApiKey = getWorkspaceApiKeyFromEnv();
  if (workspaceApiKey && isWorkspaceApiKey(workspaceApiKey)) {
    return { api_key: workspaceApiKey };
  }
  const auth = await readAuth();
  if (isTokenExpired(auth)) {
    const refreshedToken = await refreshAndSaveTokens();
    if (refreshedToken) {
      return { Authorization: `Bearer ${refreshedToken}` };
    }
  }
  return { Authorization: `Bearer ${auth.accessToken}` };
}

export function parseStreamEvent(
  eventName: string,
  data: string,
): StreamEvent | null {
  try {
    const payload = JSON.parse(data);
    if (eventName === "end") {
      const result = StreamEndEventSchema.safeParse(payload);
      return result.success ? { kind: "end", end: result.data } : null;
    }
    if (eventName === "") {
      const result = StreamLogEventSchema.safeParse(payload);
      return result.success ? { kind: "log", log: result.data } : null;
    }
    return null;
  } catch {
    return null;
  }
}

const STREAM_SILENCE_TIMEOUT_MS = 60_000;

interface StreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<unknown>;
}

async function readOrSilence(
  reader: StreamReader,
): Promise<{ done: boolean; value?: Uint8Array } | "silence"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<"silence">((resolve) => {
    timer = setTimeout(() => resolve("silence"), STREAM_SILENCE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([reader.read(), silence]);
  } finally {
    clearTimeout(timer);
  }
}

async function* readLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader: StreamReader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const result = await readOrSilence(reader);
      if (result === "silence") return;
      if (result.done || !result.value) return;
      buffered += decoder.decode(result.value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      yield* lines;
    }
  } finally {
    // Cancel, don't just unlock: an unconsumed body keeps its socket alive in
    // the fetch pool, so a long tail's reconnects pile up connections.
    await reader.cancel().catch(() => {});
  }
}

export async function* readStreamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  let eventName = "";
  for await (const line of readLines(body)) {
    if (line.startsWith(":")) {
      yield { kind: "ping" };
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      const event = parseStreamEvent(eventName, line.slice(5));
      eventName = "";
      if (event) yield event;
      continue;
    }
    if (line.trim() === "") eventName = "";
  }
}

const STREAM_CONNECT_TIMEOUT_MS = 10_000;

export type LogStreamAttempt =
  | { kind: "stream"; events: AsyncGenerator<StreamEvent> }
  | { kind: "refused" }
  | { kind: "transient" };

export const isWorthReconnecting = (status: number) => status >= 500;

export async function openLogStream(
  filters: LogStreamFilters,
): Promise<LogStreamAttempt> {
  // Outside the try on purpose: a missing or unrefreshable token is a real
  // error to surface, not a transient failure to retry for 15 seconds.
  const url = buildStreamUrl(filters);
  const headers = {
    Accept: "text/event-stream",
    ...(await buildStreamAuthHeaders()),
  };
  const connectPhase = new AbortController();
  const connectTimer = setTimeout(
    () => connectPhase.abort(),
    STREAM_CONNECT_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: connectPhase.signal });
  } catch {
    return { kind: "transient" };
  } finally {
    clearTimeout(connectTimer);
  }
  if (!response.ok) {
    return isWorthReconnecting(response.status)
      ? { kind: "transient" }
      : { kind: "refused" };
  }
  if (!response.body) return { kind: "transient" };
  return { kind: "stream", events: readStreamEvents(response.body) };
}
