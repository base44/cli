/**
 * Runtime-secrets activation, end to end in real workerd.
 *
 * Pull protocol: the SECRETS are baked into the script as an encrypted blob,
 * split across `BASE44_SECRETS_BLOB_<n>` bindings; a cold isolate PULLS the app
 * DATA KEY from the activation endpoint — proving possession of the per-app
 * activation key over the backend-minted challenge — and receives it in
 * plaintext over TLS. The "backend" side (endpoint and blob) is simulated with
 * Node crypto using the exact protocol from
 * backend/app/cloudflare_functions/activation_handshake.py and
 * activation_challenge.py:
 *
 *   proof    = HMAC-SHA256(activationKey, "cf-activation-proof-v1." || challenge)
 *   answer   = {"key": b64url(dataKey(32))}
 *   blob     = keyId(1) || nonce(12) || AES-256-GCM(dataKey, nonce, deflate(JSON), AAD=app_id)
 *
 * The pull is the only way in: a request without a challenge, or a script
 * without either pull binding, is a classified 503 (the v3 push handshake was
 * retired 2026-09-11).
 *
 * A persistent Miniflare instance stands in for one isolate and its
 * `outboundService` for the network, so sequential requests exercise the
 * cold → pulled → warm lifecycle.
 */

import { createHash, createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";

import { bundle, bundleApp } from "../src/bundler";
import { bundleOrThrow as bundled, bundleAppOrThrow as bundledApp } from "./helpers";
import { WFP_COMPAT_DATE } from "./workerd";

const APP_ID = "app-e2e-1";
const CHALLENGE_HEADER = "Base44-Activation-Challenge";
const PROOF_HEADER = "Base44-Activation-Proof";
const ERROR_HEADER = "X-Base44-Activation-Error";
const MARKER_HEADER = "X-Base44-Activation";
const DIGEST_HEADER = "X-Base44-Activation-Digest";
// Independent of the shim: what the backend recomputes for CHALLENGE.
const sha256b64url = (text: string) => createHash("sha256").update(text).digest("base64url");
const errorDigestFor = (reason: string) => sha256b64url(`cf-activation-error-v1.${reason}.${CHALLENGE}`);
const markerDigestFor = () => sha256b64url(`cf-activation-marker-v1.${CHALLENGE}`);
// Opaque to the shim, which forwards it verbatim; only the endpoint verifies it.
const CHALLENGE = "1.eyJhIjoiYXBwLWUyZS0xIiwiZSI6MH0.c2lnbmF0dXJl";
const ACTIVATION_URL = "https://api.base44.test/api/backend-functions/activation";
const ACTIVATION_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const PULL_BINDINGS = {
  BASE44_ACTIVATION_URL: ACTIVATION_URL,
  BASE44_ACTIVATION_KEY: ACTIVATION_KEY,
};
// Keep in sync with SECRETS_BLOB_BINDING_PREFIX / BLOB_CHUNK_MAX_CHARS in
// activation_handshake.py and with the shim's BLOB_BINDING_PREFIX.
const BLOB_PREFIX = "BASE44_SECRETS_BLOB";
const BLOB_CHUNK_MAX_CHARS = 4_800;

// ── Node-side mirror of the backend ─────────────────────────────────────────

function bytesToB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function newDataKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** The at-rest blob: keyId || nonce || AES-GCM(deflated JSON), base64url. */
async function encryptBlob(
  dataKey: Uint8Array<ArrayBuffer>,
  appId: string,
  secrets: Record<string, string>,
  keyId = 1,
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(appId) },
    key,
    new Uint8Array(deflateSync(new TextEncoder().encode(JSON.stringify({ secrets })))),
  );
  const out = new Uint8Array(1 + nonce.length + ct.byteLength);
  out[0] = keyId;
  out.set(nonce, 1);
  out.set(new Uint8Array(ct), 1 + nonce.length);
  return bytesToB64url(out);
}

/** Split a blob into the bindings the deploy path would attach. */
function blobBindings(blob: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0, start = 0; start < Math.max(blob.length, 1); i++, start += BLOB_CHUNK_MAX_CHARS) {
    out[`${BLOB_PREFIX}_${i}`] = blob.slice(start, start + BLOB_CHUNK_MAX_CHARS);
  }
  return out;
}

/** The endpoint's side of the proof check (activation_challenge.verify_proof). */
function proofFor(challenge: string, keyB64 = ACTIVATION_KEY): string {
  return createHmac("sha256", Buffer.from(keyB64, "base64url"))
    .update(`cf-activation-proof-v1.${challenge}`)
    .digest("base64url");
}

// ── The activation endpoint ─────────────────────────────────────────────────

interface Pull {
  method: string;
  url: string;
  /** Every `Base44-*` header on the request, lowercased and sorted. */
  protocolHeaders: string[];
  challenge: string | null;
  proof: string | null;
  body: string;
}
interface PullContext {
  pull: Pull;
  dataKey: Uint8Array<ArrayBuffer>;
  /** The endpoint's success answer: the blob's data key, as JSON over TLS. */
  keyResponse: () => Response;
}
type Respond = (ctx: PullContext) => Response | Promise<Response>;
interface Endpoint {
  /** Every request the isolate's native fetch issued, in order. */
  pulls: Pull[];
  outbound: (request: Request) => Promise<Response>;
}

/** `{"key": b64url(dataKey)}`, as activation_handshake.py answers a verified pull. */
function keyResponse(dataKey: Uint8Array): Response {
  return Response.json({ key: bytesToB64url(dataKey) }, { headers: { "cache-control": "no-store" } });
}

/** Stand-in for the network: records every outbound request; at the activation
 *  URL it verifies the proof and answers the data key (or whatever `respond`
 *  says), elsewhere an "ordinary:<host>" body. */
function activationEndpoint(dataKey: Uint8Array<ArrayBuffer>, respond?: Respond): Endpoint {
  const pulls: Pull[] = [];
  return {
    pulls,
    outbound: async (request) => {
      const pull: Pull = {
        method: request.method,
        url: request.url,
        protocolHeaders: [...request.headers.keys()].filter((h) => h.startsWith("base44-")).sort(),
        challenge: request.headers.get(CHALLENGE_HEADER),
        proof: request.headers.get(PROOF_HEADER),
        body: await request.text(),
      };
      pulls.push(pull);
      if (pull.url !== ACTIVATION_URL) return new Response(`ordinary:${new URL(pull.url).hostname}`);
      if (respond) return respond({ pull, dataKey, keyResponse: () => keyResponse(dataKey) });
      if (pull.proof !== proofFor(pull.challenge ?? "")) {
        return Response.json({ error: { code: "invalid_proof" } }, { status: 401 });
      }
      return keyResponse(dataKey);
    },
  };
}

// ── One-isolate session ──────────────────────────────────────────────────────

type DispatchInit = { headers?: Record<string, string>; method?: string; body?: string };
type Dispatch = (init?: DispatchInit) => Promise<Response>;

interface IsolateOptions {
  secrets?: Record<string, string>;
  bindings?: Record<string, unknown>;
  serviceBindings?: Record<string, (request: Request) => Response | Promise<Response>>;
  dataKey?: Uint8Array<ArrayBuffer>;
  blobAppId?: string;
  omitBlob?: boolean;
  /** Receives what the isolate's native fetch sends (the pull, user fetches). */
  outbound?: (request: Request) => Promise<Response>;
}

/** Boot an isolate carrying `secrets` as a baked blob; hand the test its
 *  dispatcher and the blob bindings. */
async function withIsolate(
  bundle: string,
  run: (dispatch: Dispatch, blob: Record<string, string>) => Promise<void>,
  opts: IsolateOptions = {},
): Promise<void> {
  const dataKey = opts.dataKey ?? newDataKey();
  const blob = blobBindings(await encryptBlob(dataKey, opts.blobAppId ?? APP_ID, opts.secrets ?? {}));
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "_bundled.mjs", contents: bundle }],
    compatibilityDate: WFP_COMPAT_DATE,
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      BASE44_APP_ID: APP_ID,
      ...(opts.omitBlob ? {} : blob),
      ...(opts.bindings ?? {}),
    },
    ...(opts.serviceBindings ? { serviceBindings: opts.serviceBindings } : {}),
    ...(opts.outbound ? { outboundService: opts.outbound } : {}),
  });
  try {
    await run(
      (init) => mf.dispatchFetch("http://localhost/", init) as unknown as Promise<Response>,
      blob,
    );
  } finally {
    await mf.dispose();
  }
}

/** An isolate with the pull bindings and an endpoint sealing the blob's data key. */
async function withPullIsolate(
  bundle: string,
  run: (dispatch: Dispatch, endpoint: Endpoint, blob: Record<string, string>) => Promise<void>,
  opts: IsolateOptions & { respond?: Respond; url?: string } = {},
): Promise<void> {
  const dataKey = newDataKey();
  const endpoint = activationEndpoint(dataKey, opts.respond);
  await withIsolate(bundle, (dispatch, blob) => run(dispatch, endpoint, blob), {
    ...opts,
    dataKey,
    bindings: {
      ...PULL_BINDINGS,
      ...(opts.url ? { BASE44_ACTIVATION_URL: opts.url } : {}),
      ...(opts.bindings ?? {}),
    },
    outbound: endpoint.outbound,
  });
}

interface WorkerdSocket {
  accept(): void;
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** A request as the backend forwards it: with a challenge attached. */
const challenged = (headers: Record<string, string> = {}): DispatchInit => ({
  headers: { [CHALLENGE_HEADER]: CHALLENGE, ...headers },
});

const REPORTER = `
Deno.serve((req) => Response.json({
  secret: Deno.env.get("MY_SECRET") ?? null,
  viaProcess: (globalThis.process?.env?.MY_SECRET) ?? null,
  viaBridge: globalThis.Base44?.secrets?.get("MY_SECRET") ?? null,
  sawChallenge: req.headers.get("Base44-Activation-Challenge"),
}));
`;
let reporterBundle: Promise<string> | undefined;
const reporter = () => (reporterBundle ??= bundled(REPORTER, "main.ts", false, true));

describe("runtime-secrets activation in workerd", () => {
  it("cold isolate pulls the data key once — challenge and proof, no keypair — and serves the same request", async () => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const served = await dispatch(challenged());
      expect(served.status).toBe(200);
      expect(await served.json()).toEqual({
        secret: "sk-live-123",
        viaProcess: "sk-live-123",
        viaBridge: "sk-live-123", // Base44.secrets.get reads the installed env
        sawChallenge: null,       // the challenge is stripped before user code
      });
      expect(served.headers.get(MARKER_HEADER)).toMatch(/^pulled;ms=\d+$/);

      expect(pulls).toHaveLength(1);
      const [pull] = pulls;
      expect(pull.method).toBe("POST");
      expect(pull.url).toBe(ACTIVATION_URL);
      expect(pull.body).toBe("");
      // Exactly the two protocol headers — no pubkey — and a proof under the
      // activation key over exactly that challenge.
      expect(pull.protocolHeaders).toEqual(["base44-activation-challenge", "base44-activation-proof"]);
      expect(pull.challenge).toBe(CHALLENGE);
      expect(pull.proof).toBe(proofFor(CHALLENGE));

      // Warm: served from isolate memory — no pull, no marker, even with a
      // fresh challenge on the request.
      const warm = await dispatch(challenged());
      expect(warm.status).toBe(200);
      expect(((await warm.json()) as { secret: string }).secret).toBe("sk-live-123");
      expect(warm.headers.get(MARKER_HEADER)).toBeNull();
      expect(pulls).toHaveLength(1);
    }, { secrets: { MY_SECRET: "sk-live-123" } });
  });

  it("50 concurrent cold requests on one isolate make exactly one pull", async () => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const responses = await Promise.all(
        Array.from({ length: 50 }, () => dispatch(challenged())),
      );
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(((await res.json()) as { secret: string }).secret).toBe("herd");
      }
      expect(pulls).toHaveLength(1);
      // Only the request that performed the install carries the marker; the
      // riders merely waited for it.
      const marked = responses.filter((r) => r.headers.get(MARKER_HEADER) !== null);
      expect(marked).toHaveLength(1);
      expect(marked[0].headers.get(DIGEST_HEADER)).toBe(markerDigestFor());
    }, { secrets: { MY_SECRET: "herd" } });
  });

  it("a failed pull under 50 concurrent cold requests is one pull, and every request gets its reason", async () => {
    // The riders resume only after the failed attempt set the cooldown, so none
    // of them starts its own pull.
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const responses = await Promise.all(Array.from({ length: 50 }, () => dispatch(challenged())));
      for (const res of responses) {
        expect(res.status).toBe(503);
        expect(res.headers.get(ERROR_HEADER)).toBe("endpoint_5xx");
        // Bound to the request's challenge: the backend trusts the reason only so.
        expect(res.headers.get(DIGEST_HEADER)).toBe(errorDigestFor("endpoint_5xx"));
      }
      expect(pulls).toHaveLength(1);
    }, { secrets: { MY_SECRET: "x" }, respond: () => new Response("", { status: 500 }) });
  });

  it("an unreadable blob under 50 concurrent cold requests is one pull, latched for every request", async () => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const responses = await Promise.all(Array.from({ length: 50 }, () => dispatch(challenged())));
      for (const res of responses) {
        expect(res.status).toBe(503);
        expect(res.headers.get(ERROR_HEADER)).toBe("blob_unreadable");
        expect(res.headers.get(DIGEST_HEADER)).toBe(errorDigestFor("blob_unreadable"));
      }
      const later = await dispatch(challenged());
      expect(later.headers.get(ERROR_HEADER)).toBe("blob_unreadable");
      expect(later.headers.get(DIGEST_HEADER)).toBe(errorDigestFor("blob_unreadable"));
      expect(pulls).toHaveLength(1);
    }, { secrets: { MY_SECRET: "x" }, blobAppId: "other-app" });
  });

  it("a 409 answers only its own request: the riders re-pull once and are served, one marker", async () => {
    // A spent challenge says nothing about the next one, so it opens no cooldown;
    // the install chain lets exactly one rider pull again and the rest ride it.
    let answered = 0;
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const responses = await Promise.all(Array.from({ length: 50 }, () => dispatch(challenged())));
      const failed = responses.filter((r) => r.status === 503);
      expect(failed).toHaveLength(1);
      expect(failed[0].headers.get(ERROR_HEADER)).toBe("endpoint_409");
      expect(failed[0].headers.get(DIGEST_HEADER)).toBe(errorDigestFor("endpoint_409"));
      for (const res of responses.filter((r) => r.status !== 503)) {
        expect(res.status).toBe(200);
        expect(((await res.json()) as { secret: string }).secret).toBe("x");
      }
      expect(pulls).toHaveLength(2);
      expect(responses.filter((r) => r.headers.get(MARKER_HEADER) !== null)).toHaveLength(1);
    }, {
      secrets: { MY_SECRET: "x" },
      respond: (ctx) => (answered++ === 0 ? new Response("", { status: 409 }) : ctx.keyResponse()),
    });
  });

  it("pulls over native fetch — never the STATIC_EGRESS binding, never the telemetry census", async () => {
    // Static egress and the telemetry patch both wrap globalThis.fetch from the
    // entry's module body; the shim captured fetch before either ran. The
    // static-egress wrapper is the inner one, so a fetch that bypasses it
    // bypassed the telemetry wrapper too. The user fetch proves the binding
    // route is live for user code while the pull went to the network.
    const m = await bundled(`
      Deno.serve(async () => {
        const viaUser = await (await fetch("https://user.example.com/probe")).text();
        return Response.json({ viaUser, secret: Deno.env.get("MY_SECRET") ?? null });
      });
    `, "main.ts", true, true);
    const staticHosts: string[] = [];
    await withPullIsolate(m, async (dispatch, { pulls }) => {
      const served = await dispatch(challenged());
      expect(served.status).toBe(200);
      expect(await served.json()).toEqual({ viaUser: "static:user.example.com", secret: "sk-live" });
      expect(staticHosts).toEqual(["user.example.com"]);
      expect(pulls.map((p) => p.url)).toEqual([ACTIVATION_URL]);
      expect(served.headers.get("X-B44-Post-Response-Telemetry")).toBeNull();
    }, {
      secrets: { MY_SECRET: "sk-live" },
      bindings: { BASE44_STATIC_EGRESS_ENABLED: "1" },
      serviceBindings: {
        STATIC_EGRESS: async (request) => {
          const hostname = new URL(request.url).hostname;
          staticHosts.push(hostname);
          return new Response(`static:${hostname}`);
        },
      },
    });
  });

  it("a hung endpoint is endpoint_timeout at the 5 s deadline; the isolate re-pulls after the cooldown", async () => {
    let hang = true;
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const t0 = Date.now();
      const timedOut = await dispatch(challenged());
      const elapsed = Date.now() - t0;
      expect(timedOut.status).toBe(503);
      expect(timedOut.headers.get(ERROR_HEADER)).toBe("endpoint_timeout");
      expect(timedOut.headers.get("Cache-Control")).toBe("no-store");
      expect(await timedOut.text()).toBe("");
      // The shim's deadline, not the backend's 300 s one.
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(20_000);
      expect(pulls).toHaveLength(1);

      // Inside the cooldown: the last reason, without a second pull.
      hang = false;
      const cooling = await dispatch(challenged());
      expect(cooling.status).toBe(503);
      expect(cooling.headers.get(ERROR_HEADER)).toBe("endpoint_timeout");
      expect(pulls).toHaveLength(1);

      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const served = await dispatch(challenged());
      expect(served.status).toBe(200);
      expect(((await served.json()) as { secret: string }).secret).toBe("late");
      expect(pulls).toHaveLength(2);
    }, {
      secrets: { MY_SECRET: "late" },
      respond: ({ keyResponse }) => (hang ? new Promise<Response>(() => {}) : keyResponse()),
    });
  });

  it.each([
    [400, "endpoint_400"],
    [401, "endpoint_401"],
    [409, "endpoint_409"],
    [429, "endpoint_429"],
    [418, "endpoint_4xx"],
    [500, "endpoint_5xx"],
    [503, "endpoint_5xx"],
    // redirect: "manual" surfaces the 3xx itself — not the protocol.
    [302, "response_malformed"],
  ])("endpoint status %i is a 503 %s with an empty no-store body — classified by status, its error body unread", async (status, reason) => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const res = await dispatch(challenged());
      expect(res.status).toBe(503);
      expect(res.headers.get(ERROR_HEADER)).toBe(reason);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe("");
      expect(pulls).toHaveLength(1);
    }, {
      respond: () =>
        Response.json({ error: { code: "refused", message: "nope" } }, {
          status,
          headers: status === 302 ? { location: "https://elsewhere.test/" } : {},
        }),
    });
  });

  it("a fetch that cannot be issued is endpoint_unreachable", async () => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const res = await dispatch(challenged());
      expect(res.status).toBe(503);
      expect(res.headers.get(ERROR_HEADER)).toBe("endpoint_unreachable");
      expect(await res.text()).toBe("");
      expect(pulls).toHaveLength(0);
    }, { url: "https://api.base44 .test/api/backend-functions/activation" });
  });

  it.each([
    ["whose key decodes to 31 bytes", ({ dataKey }: PullContext) =>
      Response.json({ key: bytesToB64url(dataKey.slice(0, 31)) })],
    ["that is not JSON", () => new Response("not json")],
    ["with no key", () => Response.json({})],
    ["whose key is not a string", () => Response.json({ key: 42 })],
    ["whose key is not base64url", () => Response.json({ key: "*".repeat(43) })],
    ["over 1024 chars", () => new Response(`{"key":"${"A".repeat(1100)}"}`)],
  ])("response_malformed: a 200 body %s is refused; the cooldown answers the next request without a pull, then the isolate re-pulls", async (_shape, malformed) => {
    let bad = true;
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const res = await dispatch(challenged());
      expect(res.status).toBe(503);
      expect(res.headers.get(ERROR_HEADER)).toBe("response_malformed");
      expect(await res.text()).toBe("");
      expect(pulls).toHaveLength(1);
      const cooling = await dispatch(challenged());
      expect(cooling.headers.get(ERROR_HEADER)).toBe("response_malformed");
      expect(pulls).toHaveLength(1);
      // Not latched: past the cooldown a well-formed answer installs.
      bad = false;
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const served = await dispatch(challenged());
      expect(served.status).toBe(200);
      expect(((await served.json()) as { secret: string }).secret).toBe("x");
      expect(pulls).toHaveLength(2);
    }, { secrets: { MY_SECRET: "x" }, respond: (ctx) => (bad ? malformed(ctx) : ctx.keyResponse()) });
  });

  it.each([
    ["blob_unreadable", "blob baked for another app", { blobAppId: "other-app" }],
    ["blob_unreadable", "corrupt blob", { bindings: { BASE44_SECRETS_BLOB_0: "A".repeat(64) } }],
    ["blob_missing", "no blob bindings", { omitBlob: true }],
  ])("%s (%s) is latched: exactly one pull, then 503s for the isolate's lifetime", async (reason, _shape, opts) => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      for (let i = 0; i < 3; i++) {
        const res = await dispatch(challenged());
        expect(res.status).toBe(503);
        expect(res.headers.get(ERROR_HEADER)).toBe(reason);
        expect(await res.text()).toBe("");
      }
      expect(pulls).toHaveLength(1);
    }, { secrets: { MY_SECRET: "x" }, ...opts });
  });

  it("refuses an http:// endpoint without fetching, and latches", async () => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      for (let i = 0; i < 2; i++) {
        const res = await dispatch(challenged());
        expect(res.status).toBe(503);
        expect(res.headers.get(ERROR_HEADER)).toBe("url_not_https");
        expect(await res.text()).toBe("");
      }
      expect(pulls).toHaveLength(0);
    }, { url: "http://api.base44.test/api/backend-functions/activation" });
  });

  it("challenge_missing: a cold request with no challenge is a 503 for that request only — the next challenged one pulls", async () => {
    await withPullIsolate(await reporter(), async (dispatch, { pulls }) => {
      const bare = await dispatch();
      expect(bare.status).toBe(503);
      expect(bare.headers.get(ERROR_HEADER)).toBe("challenge_missing");
      expect(bare.headers.get("Cache-Control")).toBe("no-store");
      expect(await bare.text()).toBe("");
      expect(pulls).toHaveLength(0);
      // Neither latched nor cooled down: the backend attaches a challenge to
      // every request it forwards, so the very next one pulls at once.
      const served = await dispatch(challenged());
      expect(served.status).toBe(200);
      expect(((await served.json()) as { secret: string }).secret).toBe("sk-live");
      expect(served.headers.get(MARKER_HEADER)).toMatch(/^pulled;ms=\d+$/);
      expect(pulls).toHaveLength(1);
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it.each([
    ["url_missing", "URL binding missing", { BASE44_ACTIVATION_KEY: ACTIVATION_KEY }],
    ["key_missing", "key binding missing", { BASE44_ACTIVATION_URL: ACTIVATION_URL }],
    ["url_missing", "no pull bindings", {}],
  ])("%s (%s) is latched: 503s for the isolate's lifetime, no pull, no user code", async (reason, _shape, bindings) => {
    const m = await bundled(
      'Deno.serve(() => { throw new Error("user code must not run"); });',
      "main.ts", false, true,
    );
    const endpoint = activationEndpoint(newDataKey());
    await withIsolate(m, async (dispatch) => {
      for (let i = 0; i < 3; i++) {
        const res = await dispatch(challenged());
        expect(res.status).toBe(503);
        expect(res.headers.get(ERROR_HEADER)).toBe(reason);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(await res.text()).toBe("");
      }
      expect(endpoint.pulls).toHaveLength(0);
    }, { bindings, outbound: endpoint.outbound });
  });

  it("keeps the pull bindings off every env surface user code can reach", async () => {
    const snooper = `
Deno.serve(() => {
  const globals = {};
  for (const k of Object.getOwnPropertyNames(globalThis)) {
    try { const v = globalThis[k]; if (typeof v === "string") globals[k] = v; } catch (e) {}
  }
  return Response.json({
    processEnv: Object.keys(process.env),
    denoEnv: Object.keys(Deno.env.toObject()),
    denoGetKey: Deno.env.get("BASE44_ACTIVATION_KEY") ?? null,
    denoGetUrl: Deno.env.get("BASE44_ACTIVATION_URL") ?? null,
    bridgeKey: globalThis.Base44.secrets.get("BASE44_ACTIVATION_KEY") ?? null,
    bridgeUrl: globalThis.Base44.secrets.get("BASE44_ACTIVATION_URL") ?? null,
    globals,
    secret: Deno.env.get("MY_SECRET") ?? null,
  });
});`;
    const m = await bundled(snooper, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      const served = await dispatch(challenged());
      expect(served.status).toBe(200);
      const body = (await served.json()) as { secret: string; processEnv: string[] };
      expect(body.secret).toBe("sk-live");
      // workerd mirrors string bindings into process.env — so this IS the
      // surface a leak would show on, and the app id proves the probe reads it.
      expect(body.processEnv).toContain("BASE44_APP_ID");
      const seen = JSON.stringify(body);
      expect(seen).not.toContain("BASE44_ACTIVATION_KEY");
      expect(seen).not.toContain("BASE44_ACTIVATION_URL");
      expect(seen).not.toContain(ACTIVATION_KEY);
      expect(seen).not.toContain(ACTIVATION_URL);
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it("strips forged activation headers from handler responses, keeping only the shim's own marker", async () => {
    const forger = `
Deno.serve((req) => new Response("done", {
  status: req.headers.get("x-test-status") === "503" ? 503 : 200,
  headers: {
    "X-Base44-Activation-Error": "endpoint_5xx",
    "X-Base44-Activation": "pulled;ms=999999",
  },
}));`;
    const m = await bundled(forger, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch, { pulls }) => {
      // The installing request: the forged copies go, the genuine marker stays.
      const first = await dispatch(challenged());
      expect(first.status).toBe(200);
      expect(await first.text()).toBe("done");
      expect(first.headers.get(ERROR_HEADER)).toBeNull();
      expect(first.headers.get(MARKER_HEADER)).toMatch(/^pulled;ms=\d+$/);
      expect(first.headers.get(MARKER_HEADER)).not.toBe("pulled;ms=999999");
      // A warm handler 503 with a forged error header must not read as a failed
      // activation: the request ran, and it is billable.
      const warm = await dispatch(challenged({ "x-test-status": "503" }));
      expect(warm.status).toBe(503);
      expect(await warm.text()).toBe("done");
      expect(warm.headers.get(ERROR_HEADER)).toBeNull();
      expect(warm.headers.get(MARKER_HEADER)).toBeNull();
      expect(pulls).toHaveLength(1);
    });
  });

  it("strips the v3 headers both ways: no envelope reaches user code, no forged signal leaves", async () => {
    // A pull shim neither reads an envelope nor signals, so any copy is a stray
    // or a forgery (the backend also refuses a signal from a pull-shim script id).
    const legacy = `
Deno.serve((req) => new Response(JSON.stringify({ envelope: req.headers.get("Base44-Runtime-Secrets") }), {
  status: 503,
  headers: { "X-Base44-Needs-Activation": "forged-pubkey" },
}));`;
    const m = await bundled(legacy, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      // Cold with a challenge (the pull installs), then warm without one.
      for (const init of [
        challenged({ "Base44-Runtime-Secrets": "stray" }),
        { headers: { "Base44-Runtime-Secrets": "stray" } },
      ]) {
        const res = await dispatch(init);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ envelope: null });
        expect(res.headers.get("X-Base44-Needs-Activation")).toBeNull();
      }
    });
  });

  it("reassembles a blob split across many bindings", async () => {
    // The v3 ceiling mechanism: CF caps one secret_text value at 5 KB, so a
    // large blob arrives as BASE44_SECRETS_BLOB_0..n and the shim concatenates
    // in index order. A rejoin bug yields truncated ciphertext, and AES-GCM
    // fails closed — so this passing proves the reassembly is byte-exact.
    // Random bytes: deflate cannot shrink them, so the blob really does exceed
    // one binding.
    const big = Buffer.from(crypto.getRandomValues(new Uint8Array(9_000))).toString("base64");
    await withPullIsolate(await reporter(), async (dispatch, _endpoint, blob) => {
      expect(Object.keys(blob).length).toBeGreaterThan(1);
      expect(Object.values(blob).every((c) => c.length <= BLOB_CHUNK_MAX_CHARS)).toBe(true);
      const served = await dispatch(challenged());
      expect(served.status).toBe(200);
      expect(((await served.json()) as { secret: string }).secret).toBe(big);
    }, { secrets: { MY_SECRET: big } });
  });

  it("keeps the blob opaque to user code — bindings hold ciphertext only", async () => {
    // The blob IS a binding, so user code can read it. That is acceptable only
    // because it is ciphertext: the plaintext must not appear there, and the
    // data key never lands on env.
    const snooper = `
const probes = {};
for (let i = 0; i < 3; i++) {
  const k = "BASE44_SECRETS_BLOB_" + i;
  probes[k] = Deno.env.get(k) ?? globalThis.Base44?.secrets?.get(k) ?? null;
}
Deno.serve(() => Response.json({ probes, secret: Deno.env.get("MY_SECRET") ?? null }));`;
    const m = await bundled(snooper, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      const served = await dispatch(challenged());
      const body = (await served.json()) as {
        probes: Record<string, string | null>;
        secret: string | null;
      };
      // The function resolves its own secret …
      expect(body.secret).toBe("sk-live-plaintext");
      // … while whatever it can see of the blob is ciphertext: no plaintext, no
      // key names. (Reading the raw binding at all is incidental — the point is
      // that doing so yields nothing.)
      const seen = JSON.stringify(body.probes);
      expect(seen).not.toContain("sk-live-plaintext");
      expect(seen).not.toContain("MY_SECRET");
    }, { secrets: { MY_SECRET: "sk-live-plaintext" } });
  });

  it("delivers the PDS manifest to manifest.ts via a private single-instance store (not a global)", async () => {
    // Proves the closed channel end to end: the shim writes the manifest into
    // the private store and manifest.ts reads it — they MUST dedupe to one
    // module instance, or lookup would see an empty manifest and throw "not
    // bound". User code reaches PDS only through the public surface.
    const fn = `
import { http } from "base44:private-data-sources/http";
Deno.serve(() => {
  let lookup;
  try { http("api"); lookup = "resolved"; }
  catch (e) { lookup = String((e && e.message) || e); }
  return Response.json({
    lookup,
    manifestGlobal: globalThis.__base44RuntimeManifest ?? null,
  });
});`;
    const m = await bundled(fn, "main.ts", false, true);
    const manifest = JSON.stringify([
      {
        name: "api", type: "http", bindingName: "DATA_SOURCE_API",
        bindingKind: "vpc_service", host: "api.internal", port: 443,
        baseUrl: "https://api.internal:443",
      },
    ]);
    await withPullIsolate(m, async (dispatch) => {
      const served = await dispatch(challenged());
      const body = (await served.json()) as { lookup: string; manifestGlobal: unknown };
      expect(body.lookup).toBe("resolved");
      expect(body.lookup).not.toMatch(/not bound/); // single-instance store worked
      expect(body.manifestGlobal).toBeNull();       // never on a user global
    }, {
      secrets: { BASE44_PRIVATE_DATA_SOURCES: manifest },
      bindings: { DATA_SOURCE_API: { stub: true } }, // present so pinning keeps the entry
    });
  });

  it("a blob with no manifest does not fall back to a stale manifest binding", async () => {
    // "Delivered empty" must differ from "not delivered": the shim stores ""
    // so manifest.ts treats the handshake as authoritative instead of reading
    // the Worker BINDING (unfiltered, unpinned).
    const fn = `
import { http } from "base44:private-data-sources/http";
Deno.serve(() => {
  let lookup;
  try { http("api"); lookup = "resolved"; }
  catch (e) { lookup = String((e && e.message) || e); }
  return Response.json({ lookup });
});`;
    const m = await bundled(fn, "main.ts", false, true);
    const staleManifest = JSON.stringify([
      {
        name: "api", type: "http", bindingName: "DATA_SOURCE_API",
        bindingKind: "vpc_service", host: "api.internal", port: 443,
        baseUrl: "https://api.internal:443",
      },
    ]);
    await withPullIsolate(m, async (dispatch) => {
      const served = await dispatch(challenged());
      const body = (await served.json()) as { lookup: string };
      expect(body.lookup).toMatch(/not bound/);
      expect(body.lookup).not.toBe("resolved");
    }, {
      secrets: { MY_SECRET: "sk-live" }, // no manifest in the blob
      bindings: {
        BASE44_PRIVATE_DATA_SOURCES: staleManifest, // leftover from binding mode
        DATA_SOURCE_API: { stub: true },
      },
    });
  });

  it("never re-installs, so user-patched globals never see the plaintext", async () => {
    // User code patches the primordials the install path uses, then keeps
    // sending challenged requests. Because install happens once per isolate,
    // before any user code, the patched globals observe nothing and the
    // endpoint is never consulted again.
    const snooper = `
const seen = [];
const realParse = JSON.parse;
JSON.parse = (t, ...r) => { seen.push("parse:" + String(t).slice(0, 40)); return realParse(t, ...r); };
const realDecode = TextDecoder.prototype.decode;
TextDecoder.prototype.decode = function (...a) {
  const out = realDecode.apply(this, a);
  seen.push("decode:" + String(out).slice(0, 40));
  return out;
};
Deno.serve(() => Response.json({ secret: Deno.env.get("MY_SECRET") ?? null, seen }));
`;
    const m = await bundled(snooper, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch, { pulls }) => {
      const first = await dispatch(challenged());
      expect(((await first.json()) as { secret: string }).secret).toBe("sk-live");

      const later = await dispatch(challenged());
      const body = (await later.json()) as { secret: string; seen: string[] };
      expect(body.secret).toBe("sk-live");         // still serving its env…
      const observed = body.seen.join("\n");        // …and nothing was decrypted again
      expect(observed).not.toContain("sk-live");
      expect(observed).not.toContain("parse:");
      expect(pulls).toHaveLength(1);
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it("strips forged shim headers even when the handler patches the Headers APIs", async () => {
    // The strip runs AFTER user code, in the same realm. A handler that patches
    // Headers.prototype.has/get/delete, Headers.prototype.entries, the array
    // iterator, and the Response.prototype.headers accessor must still not get
    // a forged error header past us — otherwise the backend reads a served,
    // side-effecting request as a failed activation.
    const forger = `
const realHas = Headers.prototype.has;
const realGet = Headers.prototype.get;
Headers.prototype.has = function (n) {
  if (String(n).toLowerCase().startsWith("x-base44")) return false;
  return realHas.call(this, n);
};
Headers.prototype.get = function (n) {
  if (String(n).toLowerCase().startsWith("x-base44")) return null;
  return realGet.call(this, n);
};
Headers.prototype.delete = function () {};
Headers.prototype.entries = function () { return [][Symbol.iterator](); };
Object.defineProperty(Response.prototype, "headers", { get() { return new Headers(); } });
Deno.serve(() => new Response("", {
  status: 503,
  headers: { "X-Base44-Activation-Error": "endpoint_timeout" },
}));
`;
    const m = await bundled(forger, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      const served = await dispatch(challenged());
      // The handler's own 503 comes back, but WITHOUT an error reason: the
      // backend must not read this as a failed isolate.
      expect(served.status).toBe(503);
      expect(served.headers.get(ERROR_HEADER)).toBeNull();
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it("never hands the challenge to a handler that patched the strip away", async () => {
    // The challenge is the one pull factor a handler could capture. Same
    // patches as above, and the handler reports whatever it can still see.
    const snooper = `
const realGet = Headers.prototype.get;
Headers.prototype.has = () => false;
Headers.prototype.get = function (n) { return realGet.call(this, n); };
Headers.prototype.delete = function () {};
Deno.serve((req) => Response.json({
  challenge: realGet.call(req.headers, "Base44-Activation-Challenge"),
  secret: Deno.env.get("MY_SECRET") ?? null,
}));
`;
    const m = await bundled(snooper, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      // Cold (the pull installs) and warm (ignored): the challenge reaches the
      // handler on neither.
      for (let i = 0; i < 2; i++) {
        const res = await dispatch(challenged());
        expect(await res.json()).toEqual({ challenge: null, secret: "sk-live" });
      }
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it.each([
    ["a header set after the strip", `
Deno.serve((req) => {
  const res = new Response("ran", { status: 503 });
  let p = Promise.resolve();
  for (let i = 0; i < 2; i++) p = p.then(() => {});
  p.then(() => { try { res.headers.set("X-Base44-Activation-Error", "internal"); } catch (e) {} });
  return res;
});`],
    ["an inherited Response then", `
Deno.serve(() => {
  Object.defineProperty(Response.prototype, "then", { configurable: true, value(resolve) {
    const r = new Response("ran", { status: 503, headers: { "X-Base44-Activation-Error": "internal" } });
    Object.defineProperty(r, "then", { value: undefined });
    resolve(r);
  } });
  return new Response("ran", { status: 503 });
});`],
    ["a patched Promise then", `
const real = Promise.prototype.then;
Promise.prototype.then = function (ok, bad) {
  const swap = (v) => v instanceof Response && v.status === 503 && !v.headers.get("X-Base44-Activation-Error")
    ? new Response("ran", { status: 503, headers: { "X-Base44-Activation-Error": "internal" } }) : v;
  return Reflect.apply(real, this, [ok && ((v) => ok(swap(v))), bad]);
};
Deno.serve(() => new Response("ran", { status: 503 }));`],
  ])("a handler 503 forged by %s is never bound to the request's challenge", async (_how, src) => {
    // The strip shares a realm with user code, so these can put the error header
    // on what leaves; the backend trusts it only with the digest of a challenge
    // user code never sees, and none of them can produce that.
    const m = await bundled(src, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      await (await dispatch(challenged())).text(); // install
      for (let i = 0; i < 3; i++) {
        const res = await dispatch(challenged());
        expect(res.status).toBe(503);
        expect(res.headers.get(DIGEST_HEADER)).not.toBe(errorDigestFor("internal"));
        expect(res.headers.get(DIGEST_HEADER)).toBeNull();
        await res.text();
      }
    });
  });

  it("keeps a manually encoded 503 body intact", async () => {
    // A handler 503 leaves as its own object unless it carried a forged shim
    // header, so init-only options such as encodeBody survive.
    const gzipper = `
Deno.serve(async () => {
  const gz = await new Response(new Blob(["gone"]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return new Response(gz, { status: 503, headers: { "Content-Encoding": "gzip" }, encodeBody: "manual" });
});
`;
    const m = await bundled(gzipper, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      for (let i = 0; i < 2; i++) {
        const res = await dispatch(challenged());
        expect(res.status).toBe(503);
        expect(await res.text()).toBe("gone");
      }
    });
  });

  it("never hands a warm request's challenge to a patched Headers.prototype.get", async () => {
    // The entry itself reads headers (version, function name) with the plain
    // API. On a warm isolate user code has already run and may have replaced
    // Headers.prototype.get; those reads must not hand it the live challenge.
    const snooper = `
const realGet = Headers.prototype.get;
let leaked = null;
Headers.prototype.get = function (n) {
  const c = Reflect.apply(realGet, this, ["Base44-Activation-Challenge"]);
  if (c) leaked = c;
  return Reflect.apply(realGet, this, [n]);
};
Deno.serve(() => Response.json({ leaked }));
`;
    const m = await bundledApp(
      [{ name: "snoop", files: { "main.ts": snooper } }], false, true,
    );
    await withPullIsolate(m, async (dispatch, { pulls }) => {
      for (let i = 0; i < 3; i++) {
        const res = await dispatch(challenged({ "Base44-Function-Name": "snoop" }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ leaked: null });
      }
      expect(pulls).toHaveLength(1);
    });
  });

  it("strips forged shim headers even when the handler patches Function.prototype.call", async () => {
    // Every captured primordial is invoked through a bound function, so
    // reassigning Function.prototype.call after the shim loaded redirects
    // nothing: the strip and the challenge scrub keep working on warm requests.
    const forger = `
const realGet = Headers.prototype.get;
Function.prototype.call = function (t, ...a) {
  if (this === realGet && /^(x-base44|base44-activation)/i.test(String(a[0]))) return null;
  return Reflect.apply(this, t, a);
};
Deno.serve((req) => Response.json(
  { challenge: Reflect.apply(realGet, req.headers, ["Base44-Activation-Challenge"]) },
  { status: 503, headers: { "X-Base44-Activation-Error": "endpoint_5xx" } },
));
`;
    const m = await bundled(forger, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch, { pulls }) => {
      for (let i = 0; i < 2; i++) {
        const res = await dispatch(challenged());
        expect(res.status).toBe(503);
        expect(res.headers.get(ERROR_HEADER)).toBeNull();
        expect(await res.json()).toEqual({ challenge: null });
      }
      expect(pulls).toHaveLength(1);
    });
  });

  it("strips forged headers from the responses the entry itself builds after user code ran", async () => {
    // The 404 / init-failure / no-handler / crash responses are built with the
    // call-time global Response, after the user module was imported. A module
    // that replaces it must not get an error header past the strip.
    const hijack = `
globalThis.Response = class extends Response {
  constructor(body, init) {
    super(body, { ...init, status: 503 });
    this.headers.set("X-Base44-Activation-Error", "endpoint_5xx");
  }
};
`;
    const m = await bundledApp(
      [
        { name: "silent", files: { "main.ts": hijack } },
        { name: "crasher", files: { "main.ts": `${hijack}\nDeno.serve(() => { throw new Error("boom"); });` } },
      ],
      false,
      true,
    );
    await withPullIsolate(m, async (dispatch) => {
      const noHandler = await dispatch(challenged({ "Base44-Function-Name": "silent" }));
      expect(noHandler.status).toBe(503);
      expect(noHandler.headers.get(ERROR_HEADER)).toBeNull();
      const crashed = await dispatch(
        challenged({ "Base44-Function-Name": "crasher", "X-B44-Capture-Logs": "1" }),
      );
      expect(crashed.status).toBe(503);
      expect(crashed.headers.get(ERROR_HEADER)).toBeNull();
      const unknown = await dispatch(challenged({ "Base44-Function-Name": "nope" }));
      expect(unknown.status).toBe(503);
      expect(unknown.headers.get(ERROR_HEADER)).toBeNull();
    });
    // The single-function entry's no-handler 503 takes the same path.
    const single = await bundled(hijack, "main.ts", false, true);
    await withPullIsolate(single, async (dispatch) => {
      const res = await dispatch(challenged());
      expect(res.status).toBe(503);
      expect(res.headers.get(ERROR_HEADER)).toBeNull();
    });
  });

  it("keeps a 101 WebSocket upgrade intact through the strip on the installing request", async () => {
    // A forged header forces the rebuild branch, which must carry `webSocket`.
    const upgrader = `
Deno.serve((req) => {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.addEventListener("message", (e) => server.send("echo:" + e.data));
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { "X-Base44-Activation-Error": "internal" },
  });
});
`;
    const m = await bundled(upgrader, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch, { pulls }) => {
      const res = await dispatch(challenged({ Upgrade: "websocket" }));
      expect(res.status).toBe(101);
      expect(res.headers.get(ERROR_HEADER)).toBeNull();
      expect(res.headers.get(MARKER_HEADER)).toMatch(/^pulled;ms=\d+$/);
      // workerd's upgrade surface, absent from the DOM Response type.
      const ws = (res as Response & { webSocket?: WorkerdSocket }).webSocket!;
      ws.accept();
      const echoed = new Promise<string>((resolve) =>
        ws.addEventListener("message", (e) => resolve(String(e.data))),
      );
      ws.send("hi");
      expect(await echoed).toBe("echo:hi");
      ws.close();
      expect(pulls).toHaveLength(1);
    });
  });

  it("stamps the marker in place, so a manually encoded body survives the installing request", async () => {
    // Rebuilding a Response drops init-only options such as encodeBody; the
    // marker rides the handler's own headers when they are mutable.
    const gzipper = `
Deno.serve(async () => {
  const gz = await new Response(new Blob(["hello"]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return new Response(gz, { headers: { "Content-Encoding": "gzip" }, encodeBody: "manual" });
});
`;
    const m = await bundled(gzipper, "main.ts", false, true);
    await withPullIsolate(m, async (dispatch) => {
      const first = await dispatch(challenged());
      expect(first.headers.get(MARKER_HEADER)).toMatch(/^pulled;ms=\d+$/);
      expect(await first.text()).toBe("hello");
      const warm = await dispatch(challenged());
      expect(warm.headers.get(MARKER_HEADER)).toBeNull();
      expect(await warm.text()).toBe("hello");
    });
  });

  it("per-app bundles gate activation before routing and read blob secrets", async () => {
    const m = await bundledApp(
      [
        {
          name: "whoami",
          files: { "main.ts": 'Deno.serve(() => new Response(Deno.env.get("MY_SECRET") ?? "none"));' },
        },
      ],
      false,
      true,
    );
    await withPullIsolate(m, async (dispatch, { pulls }) => {
      const served = await dispatch(challenged({ "Base44-Function-Name": "whoami" }));
      expect(served.status).toBe(200);
      expect(await served.text()).toBe("per-app-secret");
      expect(served.headers.get(MARKER_HEADER)).toMatch(/^pulled;ms=\d+$/);
      expect(pulls).toHaveLength(1);
    }, { secrets: { MY_SECRET: "per-app-secret" } });
  });

  it("binding-mode bundles are untouched: no gate, env from bindings, no reserved pull names", async () => {
    // The pull-binding names are reserved only where they are bound: a
    // binding-mode function that stored a user secret under one keeps reading it.
    const m = await bundled(`
      Deno.serve(() => Response.json({
        appId: Deno.env.get("BASE44_APP_ID") ?? null,
        viaBridge: globalThis.Base44.secrets.get("BASE44_ACTIVATION_KEY") ?? null,
      }));
    `);
    await withIsolate(m, async (dispatch) => {
      const res = await dispatch();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ appId: APP_ID, viaBridge: "a-user-secret" });
      expect(res.headers.get(ERROR_HEADER)).toBeNull();
    }, { omitBlob: true, bindings: { BASE44_ACTIVATION_KEY: "a-user-secret" } });
  });

  it("bundle responses mark runtime-secrets bundles with activation: pull", async () => {
    const files = { "main.ts": 'Deno.serve(() => new Response("ok"));' };
    const plain = await bundle({ entry: "main.ts", files });
    expect(plain.ok && plain.activation).toBeUndefined();
    const pull = await bundle({ entry: "main.ts", files, runtimeSecrets: true });
    expect(pull.ok && pull.activation).toBe("pull");
    const app = await bundleApp({ functions: [{ name: "a", entry: "main.ts", files }], runtimeSecrets: true });
    expect(app.ok && app.activation).toBe("pull");
  });
});
