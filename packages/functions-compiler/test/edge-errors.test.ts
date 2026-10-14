import { describe, expect, it, vi } from "vitest";

import {
  attachEdgeErrors,
  createEdgeErrorFetch,
  EDGE_ERRORS_HEADER,
  MAX_EDGE_ERRORS,
} from "../src/edge-errors";
import { runWithWorkerEnvironment } from "../src/runtime-context";
import { createRequestScopedStaticEgressFetch } from "../src/static-egress";

const RAY = "a4a477e719d71683-PDX";

// Each fixture is a response shape Cloudflare generates itself, with where it was documented or seen.

// What non-browser clients receive, whatever the Accept header: text/plain, 17 bytes, from
// https://developers.cloudflare.com/cdn-cgi/error/1000 (checked 2026-10-14), and the body backend
// functions' raw fetch() calls received (Datadog, "error code: 522" in scheduled-function failures).
// The same match: https://github.com/adanalife/guessr/pull/408.
const PLAIN_1000 = "error code: 1000\n";

// RFC 9457 problem JSON, sent to `Accept: application/json` (the SDK's axios sends that); fields and
// `cloudflare_error` (always true) per https://developers.cloudflare.com/fundamentals/reference/error-responses/.
// Trimmed from a 524 body a backend function received through the SDK on 2026-10-05.
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
  retryable: true,
});

// "A 502 or a 504 error originating from Cloudflare appears as ... a blank page without the
// Cloudflare branding": https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-502-504/.
// Verbatim as backend functions received it, 1,185 times between 2026-09-25 and 2026-10-14 (Datadog).
const UNBRANDED_502 =
  "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n" +
  "<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>cloudflare</center>\r\n</body>\r\n</html>\r\n";

function edgeResponse(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "cf-ray": RAY, "content-length": String(body.length), ...headers },
  });
}

function streamedResponse(chunks: string[], status: number) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "cf-ray": RAY } });
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

async function reportedError(response: () => Response) {
  const { report } = await reportedErrors([response]);
  return report?.errors[0] ?? null;
}

describe("Cloudflare-generated responses it reports", () => {
  it("plain text, with the origin only, and hands the response back intact", async () => {
    const { seen, report } = await reportedErrors([() => edgeResponse(PLAIN_1000, 403)]);

    expect(await seen[0].text()).toBe(PLAIN_1000);
    expect(report).toEqual({
      errors: [
        expect.objectContaining({ target: "https://base44.app", status: 403, code: 1000, ray: RAY, egress: "shared" }),
      ],
      dropped: 0,
    });
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("RFC 9457 JSON flagged cloudflare_error, with its name, category and zone", async () => {
    const error = await reportedError(() =>
      edgeResponse(JSON_524, 524, { "content-type": "application/problem+json; charset=utf-8" }),
    );

    expect(error).toMatchObject({ status: 524, code: 524, name: "origin_response_timeout", category: "origin", zone: "example.base44.app" });
  });

  it("a challenge, from its header alone", async () => {
    // "the `cf-mitigated` header present and set to `challenge`", on every challenge page type; the body
    // is text/html of any size: https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/.
    const challenge = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>${"x".repeat(20_000)}</body></html>`;

    const error = await reportedError(() =>
      edgeResponse(challenge, 403, { "cf-mitigated": "challenge", "content-type": "text/html; charset=UTF-8" }),
    );

    expect(error).toMatchObject({ status: 403, code: 403, name: "challenge" });
  });

  it("the unbranded 5xx page, with its status as the code", async () => {
    const error = await reportedError(() => edgeResponse(UNBRANDED_502, 502, { "content-type": "text/html" }));

    expect(error).toMatchObject({ status: 502, code: 502 });
  });

  it("a body that arrives in chunks without a Content-Length", async () => {
    const error = await reportedError(() => streamedResponse(["error co", "de: 1000\n"], 403));

    expect(error).toMatchObject({ code: 1000 });
  });
});

describe("responses it leaves alone", () => {
  it("an origin's own errors, even behind Cloudflare", async () => {
    const { report } = await reportedErrors([
      () => edgeResponse(JSON.stringify({ code: 1000, message: "denied" }), 403),
      () => edgeResponse(UNBRANDED_502.replace("cloudflare", "nginx"), 502),
      () => edgeResponse(UNBRANDED_502, 403),
      () => edgeResponse(JSON.stringify({ error_code: 1000, cloudflare_error: "yes" }), 403),
      () => edgeResponse(PLAIN_1000, 403, { "cf-ray": "" }),
      () => edgeResponse(PLAIN_1000, 200),
    ]);

    expect(report).toBeNull();
  });

  it("a body past the read limit, which the function still gets in full", async () => {
    const long = `${PLAIN_1000}${" ".repeat(9_000)}`;
    const { seen, report } = await reportedErrors([() => streamedResponse([long], 403)]);

    expect(report).toBeNull();
    expect(await seen[0].text()).toBe(long);
  });

  it("never holds a fetch on a body that stalls", async () => {
    vi.useFakeTimers();
    try {
      const stalledBody = () =>
        new Response(new ReadableStream({ start() {} }), { status: 403, headers: { "cf-ray": RAY } });
      const pending = reportedErrors([stalledBody]);
      await vi.advanceTimersByTimeAsync(500);
      const { seen, report } = await pending;

      expect(seen[0].status).toBe(403);
      expect(report).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the report", () => {
  it("caps the entries and counts what it dropped", async () => {
    const { report } = await reportedErrors(
      Array.from({ length: MAX_EDGE_ERRORS + 2 }, () => () => edgeResponse(PLAIN_1000, 403)),
    );

    expect(report.errors).toHaveLength(MAX_EDGE_ERRORS);
    expect(report.dropped).toBe(2);
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
