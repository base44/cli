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

export function parseStreamEventLine(line: string): StreamLogEvent | null {
  if (!line.startsWith("data:")) return null;
  try {
    const result = StreamLogEventSchema.safeParse(JSON.parse(line.slice(5)));
    return result.success ? result.data : null;
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
): AsyncGenerator<StreamLogEvent> {
  for await (const line of readLines(body)) {
    const event = parseStreamEventLine(line);
    if (event) yield event;
  }
}

export async function openLogStream(
  filters: LogStreamFilters,
): Promise<AsyncGenerator<StreamLogEvent> | null> {
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
