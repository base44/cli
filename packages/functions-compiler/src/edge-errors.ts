/**
 * Cloudflare-generated errors on a function's own outbound fetches (1000,
 * 1016, 522, 524, ...). They never reach our API, so the Worker is the only
 * place that sees them: it records each one in the request store and reports
 * them on its response in `X-B44-Edge-Errors`, which apper's proxy logs to
 * Datadog and strips (backend/app/cloudflare_functions/edge_errors.py).
 */

import { currentWorkerRuntimeContext } from "./private-data-sources/runtime-environment";
import { isDedicatedEgressResponse } from "./static-egress";

export const EDGE_ERRORS_HEADER = "X-B44-Edge-Errors";
export const MAX_EDGE_ERRORS = 5;

// Cloudflare's own bodies are ~16 bytes as text and ~1.5 KB as JSON; only a
// body whose length is known up front is read, so a stream never stalls a fetch.
const MAX_INSPECTED_BODY_BYTES = 8192;
const BODY_READ_TIMEOUT_MS = 500;
const PLAIN_TEXT_EDGE_ERROR = /^error code: (\d{3,4})\s*$/;
// Header values must stay ASCII (workerd's headers.set throws above 0xff).
const SAFE_VALUE = /^[\x20-\x7e]{1,253}$/;

interface EdgeErrorBody {
  code: number;
  name?: string;
  category?: string;
  zone?: string;
}

interface EdgeError extends EdgeErrorBody {
  target: string;
  status: number;
  ray: string;
  egress: "dedicated" | "shared";
  elapsed_ms: number;
}

interface EdgeErrorStore {
  edgeErrors?: { errors: EdgeError[]; dropped: number };
}

function safe(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_VALUE.test(value) ? value : undefined;
}

/** The code of an error Cloudflare's edge generated itself, or null for an
 *  origin's own response. Cloudflare answers plain text (`error code: 1000`)
 *  or, to some clients, RFC 9457 JSON flagged `cloudflare_error`. */
function parseEdgeErrorBody(body: string): EdgeErrorBody | null {
  const plain = PLAIN_TEXT_EDGE_ERROR.exec(body);
  if (plain) return { code: Number(plain[1]) };
  try {
    const json: unknown = JSON.parse(body);
    if (json === null || typeof json !== "object") return null;
    const fields = json as Record<string, unknown>;
    if (fields.cloudflare_error !== true || !Number.isInteger(fields.error_code)) return null;
    return {
      code: fields.error_code as number,
      name: safe(fields.error_name),
      category: safe(fields.error_category),
      zone: safe(fields.zone),
    };
  } catch {
    return null;
  }
}

async function readEdgeError(response: Response): Promise<EdgeErrorBody | null> {
  if (response.status < 400) return null;
  const length = Number(response.headers.get("content-length"));
  if (!response.headers.get("cf-ray") || !(length > 0 && length <= MAX_INSPECTED_BODY_BYTES)) {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([
      response.clone().text(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), BODY_READ_TIMEOUT_MS);
      }),
    ]);
    return body === null ? null : parseEdgeErrorBody(body);
  } finally {
    clearTimeout(timer);
  }
}

function targetOrigin(input: RequestInfo | URL): string | null {
  try {
    const raw = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

async function recordEdgeError(
  input: RequestInfo | URL,
  response: Response,
  startedAt: number,
): Promise<void> {
  const store = currentWorkerRuntimeContext() as EdgeErrorStore | undefined;
  if (!store) return;
  const body = await readEdgeError(response);
  const target = targetOrigin(input);
  if (!body || !target) return;
  const record = (store.edgeErrors ??= { errors: [], dropped: 0 });
  if (record.errors.length >= MAX_EDGE_ERRORS) {
    record.dropped += 1;
    return;
  }
  record.errors.push({
    ...body,
    target,
    status: response.status,
    ray: safe(response.headers.get("cf-ray")) ?? "",
    egress: isDedicatedEgressResponse(response) ? "dedicated" : "shared",
    elapsed_ms: Date.now() - startedAt,
  });
}

export function createEdgeErrorFetch(innerFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = Date.now();
    const response = await innerFetch(input, init);
    try {
      await recordEdgeError(input, response, startedAt);
    } catch {
      // Observation only: never fail the function's own fetch.
    }
    return response;
  };
}

let edgeErrorFetchInstalled = false;

export function installEdgeErrorFetch(): void {
  if (edgeErrorFetchInstalled) return;
  globalThis.fetch = createEdgeErrorFetch(globalThis.fetch.bind(globalThis));
  edgeErrorFetchInstalled = true;
}

/** Mirrors this request's edge errors onto its response; clean requests and
 *  upgrade responses pass through untouched. */
export function attachEdgeErrors<T>(response: T): T {
  const record = (currentWorkerRuntimeContext() as EdgeErrorStore | undefined)?.edgeErrors;
  if (!record || !(response instanceof Response)) return response;
  if (response.status === 101 || (response as { webSocket?: unknown }).webSocket) return response;
  try {
    const wrapped = new Response(response.body, response);
    wrapped.headers.set(EDGE_ERRORS_HEADER, JSON.stringify(record));
    return wrapped as T;
  } catch {
    return response;
  }
}
