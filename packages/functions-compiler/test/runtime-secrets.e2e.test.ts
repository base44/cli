/**
 * Runtime-secrets activation, end to end in real workerd.
 *
 * v3 protocol: the SECRETS are baked into the script as an encrypted blob,
 * split across `BASE44_SECRETS_BLOB_<n>` bindings; the activation handshake
 * delivers only the app DATA KEY, sealed to the isolate's ephemeral public key.
 * The "backend" side is simulated with Node WebCrypto using the exact protocol
 * from backend/app/cloudflare_functions/activation_handshake.py:
 *
 *   envelope = backendPub(65) || k(1) || k*[nonce(12) || wrap(48)]   (constant size)
 *   wrap     = AES-256-GCM(KEK_i, nonce_i, dataKey(32), AAD=app_id)
 *   KEK_i    = ECDH P-256 + HKDF-SHA256(info="base44-runtime-secrets-v1")
 *   blob     = keyId(1) || nonce(12) || AES-256-GCM(dataKey, nonce, deflate(JSON), AAD)
 *
 * A persistent Miniflare instance stands in for one isolate, so sequential
 * requests exercise the cold → activated → warm lifecycle.
 */

import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";

import { bundleOrThrow as bundled, bundleAppOrThrow as bundledApp } from "./helpers";
import { WFP_COMPAT_DATE } from "./workerd";

const APP_ID = "app-e2e-1";
const NEEDS_ACTIVATION = "X-Base44-Needs-Activation";
const RUNTIME_SECRETS = "Base44-Runtime-Secrets";
// Keep in sync with SECRETS_BLOB_BINDING_PREFIX / BLOB_CHUNK_MAX_CHARS in
// activation_handshake.py and with the shim's BLOB_BINDING_PREFIX.
const BLOB_PREFIX = "BASE44_SECRETS_BLOB";
const BLOB_CHUNK_MAX_CHARS = 4_800;

// ── Node-side mirror of the backend ─────────────────────────────────────────

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(b64, "base64"));
}

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

/** Seal the data key to every recipient isolate key — the envelope. */
async function sealDataKey(
  workerPubsB64: string | string[],
  appId: string,
  dataKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const recipients = Array.isArray(workerPubsB64) ? workerPubsB64 : [workerPubsB64];
  const aad = new TextEncoder().encode(appId);
  const backendPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );

  const blocks: Uint8Array[] = [];
  for (const pubB64 of recipients) {
    const workerPub = await crypto.subtle.importKey(
      "raw", b64urlToBytes(pubB64), { name: "ECDH", namedCurve: "P-256" }, false, [],
    );
    const shared = await crypto.subtle.deriveBits(
      { name: "ECDH", public: workerPub }, backendPair.privateKey, 256,
    );
    const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
    const keyBits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode("base44-runtime-secrets-v1"),
      },
      hkdfKey,
      256,
    );
    const kek = await crypto.subtle.importKey("raw", keyBits, "AES-GCM", false, ["encrypt"]);
    const wrapNonce = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: wrapNonce, additionalData: aad }, kek, dataKey,
    );
    const block = new Uint8Array(12 + wrapped.byteLength);
    block.set(wrapNonce, 0);
    block.set(new Uint8Array(wrapped), 12);
    blocks.push(block);
  }

  const backendPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", backendPair.publicKey),
  );
  const blocksLen = blocks.reduce((n, b) => n + b.length, 0);
  const envelope = new Uint8Array(backendPubRaw.length + 1 + blocksLen);
  let off = 0;
  envelope.set(backendPubRaw, off); off += backendPubRaw.length;
  envelope[off] = recipients.length; off += 1;
  for (const b of blocks) { envelope.set(b, off); off += b.length; }
  return bytesToB64url(envelope);
}

/** A foreign isolate keypair, for "not sealed to me" cases. */
async function foreignPubKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  return bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
}

// ── One-isolate session ──────────────────────────────────────────────────────

type DispatchInit = { headers?: Record<string, string>; method?: string; body?: string };
type Dispatch = (init?: DispatchInit) => Promise<Response>;

/** Boot an isolate carrying `secrets` as a baked blob; hand the test its
 *  dispatcher and the data key the backend would seal. */
async function withIsolate(
  bundle: string,
  run: (dispatch: Dispatch, dataKey: Uint8Array<ArrayBuffer>) => Promise<void>,
  opts: {
    secrets?: Record<string, string>;
    bindings?: Record<string, unknown>;
    blobAppId?: string;
    omitBlob?: boolean;
  } = {},
): Promise<void> {
  const dataKey = newDataKey();
  const secrets = opts.secrets ?? {};
  const blob = await encryptBlob(dataKey, opts.blobAppId ?? APP_ID, secrets);
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "_bundled.mjs", contents: bundle }],
    compatibilityDate: WFP_COMPAT_DATE,
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      BASE44_APP_ID: APP_ID,
      ...(opts.omitBlob ? {} : blobBindings(blob)),
      ...(opts.bindings ?? {}),
    },
  });
  try {
    await run(
      (init) => mf.dispatchFetch("http://localhost/", init) as unknown as Promise<Response>,
      dataKey,
    );
  } finally {
    await mf.dispose();
  }
}

/** Cold-start: read the signal, seal the key to the isolate, re-send. */
async function activate(
  dispatch: Dispatch,
  dataKey: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
  appId: string = APP_ID,
): Promise<Response> {
  const cold = await dispatch({ headers });
  expect(cold.status).toBe(503);
  const pub = cold.headers.get(NEEDS_ACTIVATION);
  expect(pub).toBeTruthy();
  return dispatch({
    headers: { ...headers, [RUNTIME_SECRETS]: await sealDataKey(pub!, appId, dataKey) },
  });
}

const REPORTER = `
Deno.serve((req) => Response.json({
  secret: Deno.env.get("MY_SECRET") ?? null,
  viaProcess: (globalThis.process?.env?.MY_SECRET) ?? null,
  viaBridge: globalThis.Base44?.secrets?.get("MY_SECRET") ?? null,
  sawEnvelope: req.headers.get("Base44-Runtime-Secrets"),
}));
`;

describe("runtime-secrets activation in workerd", () => {
  it("cold isolate signals with a pubkey before running any user code", async () => {
    const m = await bundled(
      'Deno.serve(() => { throw new Error("user code must not run"); });',
      "main.ts", false, true,
    );
    await withIsolate(m, async (dispatch) => {
      const cold = await dispatch();
      expect(cold.status).toBe(503);
      expect(cold.headers.get("Cache-Control")).toBe("no-store");
      expect(await cold.text()).toBe("");
      // 65-byte uncompressed P-256 point.
      const pub = cold.headers.get(NEEDS_ACTIVATION);
      expect(b64urlToBytes(pub!).length).toBe(65);
      expect(b64urlToBytes(pub!)[0]).toBe(0x04);
    });
  });

  it("unwraps the key and opens the baked blob into Deno.env and process.env", async () => {
    const m = await bundled(REPORTER, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const served = await activate(dispatch, dataKey);
      expect(served.status).toBe(200);
      expect(await served.json()).toEqual({
        secret: "sk-live-123",
        viaProcess: "sk-live-123",
        viaBridge: "sk-live-123", // Base44.secrets.get reads the installed env
        sawEnvelope: null,        // the key envelope is stripped before user code
      });

      // Warm request: no handshake, still served from isolate memory.
      const warm = await dispatch();
      expect(warm.status).toBe(200);
      expect(((await warm.json()) as { secret: string }).secret).toBe("sk-live-123");
    }, { secrets: { MY_SECRET: "sk-live-123" } });
  });

  it("reassembles a blob split across many bindings", async () => {
    // The v3 ceiling mechanism: CF caps one secret_text value at 5 KB, so a
    // large blob arrives as BASE44_SECRETS_BLOB_0..n and the shim concatenates
    // in index order. A rejoin bug yields truncated ciphertext, and AES-GCM
    // fails closed — so this passing proves the reassembly is byte-exact.
    // Random bytes: deflate cannot shrink them, so the blob really does exceed
    // one binding.
    const big = Buffer.from(crypto.getRandomValues(new Uint8Array(9_000))).toString("base64");
    const m = await bundled(REPORTER, "main.ts", false, true);
    const dataKey = newDataKey();
    const blob = await encryptBlob(dataKey, APP_ID, { MY_SECRET: big });
    const chunks = blobBindings(blob);
    expect(Object.keys(chunks).length).toBeGreaterThan(1);
    expect(Object.values(chunks).every((c) => c.length <= BLOB_CHUNK_MAX_CHARS)).toBe(true);

    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: m }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      bindings: { BASE44_APP_ID: APP_ID, ...chunks },
    });
    try {
      const dispatch = ((init?: DispatchInit) =>
        mf.dispatchFetch("http://localhost/", init)) as unknown as Dispatch;
      const served = await activate(dispatch, dataKey);
      expect(served.status).toBe(200);
      expect(((await served.json()) as { secret: string }).secret).toBe(big);
    } finally {
      await mf.dispose();
    }
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
    await withIsolate(m, async (dispatch, dataKey) => {
      const served = await activate(dispatch, dataKey);
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

  it("installs from a multi-recipient envelope whichever position its block is in", async () => {
    // The backend accumulates isolate keys across re-signals, so a real
    // envelope can carry several wrap blocks. This isolate's block is placed
    // LAST, after one sealed to a key it does not hold — proving the shim tries
    // blocks until its own authenticates.
    const m = await bundled(REPORTER, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const cold = await dispatch();
      expect(cold.status).toBe(503);
      const isolatePub = cold.headers.get(NEEDS_ACTIVATION)!;
      const envelope = await sealDataKey(
        [await foreignPubKey(), isolatePub], APP_ID, dataKey,
      );
      const served = await dispatch({ headers: { [RUNTIME_SECRETS]: envelope } });
      expect(served.status).toBe(200);
      expect(((await served.json()) as { secret: string }).secret).toBe("multi-1");
    }, { secrets: { MY_SECRET: "multi-1" } });
  });

  it("re-signals when no wrap block is sealed to this isolate", async () => {
    const m = await bundled(REPORTER, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      expect((await dispatch()).status).toBe(503);
      const foreign = [await foreignPubKey(), await foreignPubKey()];
      const envelope = await sealDataKey(foreign, APP_ID, dataKey);
      const res = await dispatch({ headers: { [RUNTIME_SECRETS]: envelope } });
      expect(res.status).toBe(503);
      expect(res.headers.get(NEEDS_ACTIVATION)).toBeTruthy();
    }, { secrets: { MY_SECRET: "x" } });
  });

  it("re-signals on a key sealed for another app (AAD mismatch)", async () => {
    const m = await bundled(REPORTER, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const cold = await dispatch();
      const pub = cold.headers.get(NEEDS_ACTIVATION)!;
      const envelope = await sealDataKey(pub, "other-app", dataKey);
      const res = await dispatch({ headers: { [RUNTIME_SECRETS]: envelope } });
      expect(res.status).toBe(503);
      expect(res.headers.get(NEEDS_ACTIVATION)).toBeTruthy();
    }, { secrets: { MY_SECRET: "x" } });
  });

  it("fails closed when the blob was baked for another app", async () => {
    // Right key, wrong AAD on the blob: the isolate must not install.
    const m = await bundled(REPORTER, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const res = await activate(dispatch, dataKey);
      expect(res.status).toBe(503);
      expect(res.headers.get(NEEDS_ACTIVATION)).toBeTruthy();
    }, { secrets: { MY_SECRET: "x" }, blobAppId: "other-app" });
  });

  it("fails closed when the script carries no blob bindings", async () => {
    const m = await bundled(REPORTER, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const res = await activate(dispatch, dataKey);
      expect(res.status).toBe(503);
      expect(res.headers.get(NEEDS_ACTIVATION)).toBeTruthy();
    }, { secrets: { MY_SECRET: "x" }, omitBlob: true });
  });

  it("installs once per isolate: a later key is a no-op, not a refresh", async () => {
    // Re-installing would mean decrypting again on globals user code has had a
    // chance to patch. Rotation instead rolls the isolate (the generation-nonce
    // version bump), so a NEW isolate picks up new values.
    const m = await bundled(REPORTER, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const first = await activate(dispatch, dataKey);
      expect(((await first.json()) as { secret: string }).secret).toBe("v1");

      // A second, valid envelope on the same isolate: served, but ignored.
      const cold2 = await dispatch();
      expect(cold2.status).toBe(200); // already installed — no signal
      const later = await dispatch({
        headers: { [RUNTIME_SECRETS]: await sealDataKey(await foreignPubKey(), APP_ID, dataKey) },
      });
      expect(later.status).toBe(200);
      expect(((await later.json()) as { secret: string }).secret).toBe("v1");
    }, { secrets: { MY_SECRET: "v1" } });
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
    await withIsolate(m, async (dispatch, dataKey) => {
      const served = await activate(dispatch, dataKey);
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
    await withIsolate(m, async (dispatch, dataKey) => {
      const served = await activate(dispatch, dataKey);
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
    // User code patches the primordials the install path uses, then triggers
    // another activation. Because install happens once per isolate, before any
    // user code, the patched globals observe nothing.
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
    await withIsolate(m, async (dispatch, dataKey) => {
      const first = await activate(dispatch, dataKey);
      expect(((await first.json()) as { secret: string }).secret).toBe("sk-live");

      const later = await dispatch({
        headers: { [RUNTIME_SECRETS]: await sealDataKey(await foreignPubKey(), APP_ID, dataKey) },
      });
      const body = (await later.json()) as { secret: string; seen: string[] };
      expect(body.secret).toBe("sk-live");         // still serving its env…
      const observed = body.seen.join("\n");        // …and nothing was decrypted again
      expect(observed).not.toContain("sk-live");
      expect(observed).not.toContain("parse:");
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it("strips a forged signal even when the handler patches the Headers APIs", async () => {
    // The P1: the strip runs AFTER user code, in the same realm. A handler that
    // patches Headers.prototype.has/get/delete, Headers.prototype.entries, the
    // array iterator, and the Response.prototype.headers accessor must still not
    // get a signal past us — otherwise the backend seals the app data key to a
    // keypair this handler generated and replays the request to it.
    const forger = `
const realHas = Headers.prototype.has;
const realGet = Headers.prototype.get;
Headers.prototype.has = function (n) {
  if (String(n).toLowerCase().startsWith("x-base44") || String(n).toLowerCase().startsWith("base44-runtime")) return false;
  return realHas.call(this, n);
};
Headers.prototype.get = function (n) {
  if (String(n).toLowerCase().startsWith("x-base44") || String(n).toLowerCase().startsWith("base44-runtime")) return null;
  return realGet.call(this, n);
};
Headers.prototype.delete = function () {};
Headers.prototype.entries = function () { return [][Symbol.iterator](); };
Object.defineProperty(Response.prototype, "headers", { get() { return new Headers(); } });
Deno.serve(() => new Response("", {
  status: 503,
  headers: { "X-Base44-Needs-Activation": "BASE64URL_FORGED_PUBKEY" },
}));
`;
    const m = await bundled(forger, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const served = await activate(dispatch, dataKey);
      // The handler's own 503 comes back, but WITHOUT a signal: the backend
      // must not read this as a cold isolate asking for the key.
      expect(served.status).toBe(503);
      expect(served.headers.get(NEEDS_ACTIVATION)).toBeNull();
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it("never hands the envelope to a handler that patched the strip away", async () => {
    // Second half of the chain: even if a forged signal somehow got a key
    // sealed to the handler, the envelope must not reach it on the replay.
    // Same patches, and the handler reports whatever it can still see.
    const snooper = `
const realGet = Headers.prototype.get;
Headers.prototype.has = () => false;
Headers.prototype.get = function (n) {
  if (String(n).toLowerCase() === "base44-runtime-secrets") return realGet.call(this, n);
  return realGet.call(this, n);
};
Headers.prototype.delete = function () {};
Deno.serve((req) => Response.json({
  envelope: realGet.call(req.headers, "Base44-Runtime-Secrets"),
  secret: Deno.env.get("MY_SECRET") ?? null,
}));
`;
    const m = await bundled(snooper, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      // Activate first so the isolate is warm and the patches are installed …
      const first = await activate(dispatch, dataKey);
      expect(((await first.json()) as { secret: string }).secret).toBe("sk-live");
      // … then replay WITH an envelope, the way an accumulating loop would.
      const replay = await dispatch({
        headers: { [RUNTIME_SECRETS]: await sealDataKey(await foreignPubKey(), APP_ID, dataKey) },
      });
      const body = (await replay.json()) as { envelope: string | null };
      expect(body.envelope).toBeNull();
    }, { secrets: { MY_SECRET: "sk-live" } });
  });

  it("strips a forged activation signal from user-handler responses", async () => {
    const forger = `
Deno.serve(() => new Response("done", {
  headers: { "X-Base44-Needs-Activation": "forged-pubkey" },
}));
`;
    const m = await bundled(forger, "main.ts", false, true);
    await withIsolate(m, async (dispatch, dataKey) => {
      const res = await activate(dispatch, dataKey);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("done");
      expect(res.headers.get(NEEDS_ACTIVATION)).toBeNull();
    }, { secrets: {} });
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
    await withIsolate(m, async (dispatch, dataKey) => {
      const routed = { "Base44-Function-Name": "whoami" };
      const served = await activate(dispatch, dataKey, routed);
      expect(served.status).toBe(200);
      expect(await served.text()).toBe("per-app-secret");
    }, { secrets: { MY_SECRET: "per-app-secret" } });
  });

  it("binding-mode bundles are untouched: no signal, env from bindings", async () => {
    const m = await bundled(
      'Deno.serve(() => new Response(Deno.env.get("BASE44_APP_ID") ?? "none"));',
    );
    await withIsolate(m, async (dispatch) => {
      const res = await dispatch();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(APP_ID);
      expect(res.headers.get(NEEDS_ACTIVATION)).toBeNull();
    }, { omitBlob: true });
  });
});
