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
  | { kind: "end"; end: StreamEndEvent };

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

async function* readLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      yield* lines;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* readStreamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  let eventName = "";
  for await (const line of readLines(body)) {
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

export async function openLogStream(
  filters: LogStreamFilters,
): Promise<AsyncGenerator<StreamEvent> | null> {
  let response: Response;
  try {
    response = await fetch(buildStreamUrl(filters), {
      headers: {
        Accept: "text/event-stream",
        ...(await buildStreamAuthHeaders()),
      },
    });
  } catch {
    return null;
  }
  if (!response.ok || !response.body) return null;
  return readStreamEvents(response.body);
}
