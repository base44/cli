import { describe, expect, it, vi } from "vitest";

import {
  attachEdgeErrors,
  createEdgeErrorFetch,
  EDGE_ERRORS_HEADER,
  MAX_EDGE_ERRORS,
} from "../src/edge-errors";
import { runWithWorkerEnvironment } from "../src/runtime-context";
import { createRequestScopedStaticEgressFetch } from "../src/static-egress";

// Bodies as Cloudflare's edge sends them: plain text to most clients, RFC 9457
// JSON to some (seen on SDK calls; trimmed to the fields the reader keeps).
const PLAIN_1000 = "error code: 1000\n";
const JSON_524 = JSON.stringify({
  type: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/",
  title: "Error 524: A timeout occurred",
  status: 524,
  error_code: 524,
  error_name: "origin_response_timeout",
  error_category: "origin",
  ray_id: "a45abdff3c99d82e",
  zone: "example.base44.app",
  cloudflare_error: true,
});

function edgeResponse(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "cf-ray": "a4a477e719d71683-PDX", "content-length": String(body.length), ...headers },
  });
}

/** Runs `body` the way a handler runs: inside its own request store. */
function inRequest<T>(body: () => Promise<T>): Promise<T> {
  return runWithWorkerEnvironment(
    { env: "prod", secrets: {}, workerEnv: {}, waitUntil: () => {} },
    body,
  );
}

async function reportedErrors(fetches: Array<() => Response>) {
  const queue = [...fetches];
  const fetchWithEdgeErrors = createEdgeErrorFetch(vi.fn(async () => queue.shift()!()));
  return inRequest(async () => {
    const seen: Response[] = [];
    for (let i = 0; i < fetches.length; i++) {
      seen.push(await fetchWithEdgeErrors(`https://base44.app/api/apps/a/entities/Book/${i}?token=secret`));
    }
    const header = attachEdgeErrors(new Response("handler")).headers.get(EDGE_ERRORS_HEADER);
    return { seen, report: header === null ? null : JSON.parse(header) };
  });
}

describe("edge errors on a function's outbound fetches", () => {
  it("reports both Cloudflare body shapes with the origin only, and hands the response back intact", async () => {
    const { seen, report } = await reportedErrors([
      () => edgeResponse(PLAIN_1000, 403),
      () => edgeResponse(JSON_524, 524, { "content-type": "application/json" }),
    ]);

    expect(await seen[0].text()).toBe(PLAIN_1000);
    expect(report).toEqual({
      errors: [
        expect.objectContaining({ target: "https://base44.app", status: 403, code: 1000, ray: "a4a477e719d71683-PDX", egress: "shared" }),
        expect.objectContaining({ status: 524, code: 524, name: "origin_response_timeout", category: "origin", zone: "example.base44.app" }),
      ],
      dropped: 0,
    });
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("leaves an origin's own errors alone", async () => {
    const { report } = await reportedErrors([
      () => edgeResponse(JSON.stringify({ code: 1000, message: "denied" }), 403),
      () => edgeResponse(PLAIN_1000, 403, { "cf-ray": "" }),
      () => new Response(PLAIN_1000, { status: 403, headers: { "cf-ray": "a4a477e719d71683-PDX" } }),
      () => edgeResponse(PLAIN_1000, 200),
    ]);

    expect(report).toBeNull();
  });

  it("caps the report and counts what it dropped", async () => {
    const { report } = await reportedErrors(
      Array.from({ length: MAX_EDGE_ERRORS + 2 }, () => () => edgeResponse(PLAIN_1000, 403)),
    );

    expect(report.errors).toHaveLength(MAX_EDGE_ERRORS);
    expect(report.dropped).toBe(2);
  });

  it("never holds a fetch on a body that stalls", async () => {
    vi.useFakeTimers();
    try {
      const stalledBody = () =>
        new Response(new ReadableStream({ start() {} }), {
          status: 403,
          headers: { "cf-ray": "a4a477e719d71683-PDX", "content-length": "17" },
        });
      const pending = reportedErrors([stalledBody]);
      await vi.advanceTimersByTimeAsync(500);
      const { seen, report } = await pending;

      expect(seen[0].status).toBe(403);
      expect(report).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks errors that came back through dedicated static egress", async () => {
    const binding = { fetch: vi.fn(async () => edgeResponse("error code: 522", 522)) };
    const routed = createRequestScopedStaticEgressFetch(vi.fn<typeof fetch>(), () => ({
      STATIC_EGRESS: binding,
      BASE44_STATIC_EGRESS_ENABLED: "1",
    }));
    const fetchWithEdgeErrors = createEdgeErrorFetch(routed);

    const header = await inRequest(async () => {
      await fetchWithEdgeErrors("https://waba-v2.360dialog.io/v1/messages");
      return attachEdgeErrors(new Response("handler")).headers.get(EDGE_ERRORS_HEADER);
    });

    expect(JSON.parse(header!).errors[0]).toMatchObject({ code: 522, egress: "dedicated" });
  });
});
