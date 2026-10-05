// Runtime-secrets activation shim, injected only into runtime-secrets bundles: a
// cold isolate pulls its data key, opens its blob of secrets, then serves the same
// request. Wire format and threat model: backend/app/cloudflare_functions/
// activation_challenge.py (keep in sync; tests on both sides pin the reason set).

// A static module import, like node:async_hooks in the deno shim: external in
// the bundle, provided by workerd's nodejs_compat. Import bindings can't be
// reassigned by user code, so unlike the globals below this needs no capture.
import { inflateSync } from "node:zlib";

// The manifest goes into the private store shared with manifest.ts (one bundle
// instance; see runtime-manifest-store). Imported via the virtual specifier so
// build-shim leaves it external and the FINAL app compile dedupes it with
// manifest.ts's `./runtime-manifest-store` — NEVER a user-reachable global.
import { setRuntimeManifest } from "base44:private-data-sources/runtime-manifest-store";

const ACTIVATION_CHALLENGE_HEADER = "Base44-Activation-Challenge";
const ACTIVATION_PROOF_HEADER = "Base44-Activation-Proof";
const ACTIVATION_ERROR_HEADER = "X-Base44-Activation-Error";
const ACTIVATION_MARKER_HEADER = "X-Base44-Activation";
// Binds the error or the marker to THIS request's challenge, which user code never
// sees. The backend trusts neither without it: the strip below shares a realm with
// user code (a patched Promise or Response `then` runs after it), so it is hygiene.
const ACTIVATION_DIGEST_HEADER = "X-Base44-Activation-Digest";
const ERROR_DIGEST_CONTEXT = "cf-activation-error-v1.";
const MARKER_DIGEST_CONTEXT = "cf-activation-marker-v1.";
const ACTIVATION_URL_ENV = "BASE44_ACTIVATION_URL";
const ACTIVATION_KEY_ENV = "BASE44_ACTIVATION_KEY";
const PULL_TIMEOUT_MS = 5000;
const PULL_COOLDOWN_MS = 1000;
const PROOF_CONTEXT = "cf-activation-proof-v1.";
const NONCE_LEN = 12;
const DATA_KEY_LEN = 32;
const PULL_BODY_MAX_CHARS = 1024;
// The at-rest blob, split across bindings under CF's 5 KB per-value limit and
// reassembled here in index order. Keep in sync with
// SECRETS_BLOB_BINDING_PREFIX in activation_handshake.py.
const BLOB_BINDING_PREFIX = "BASE44_SECRETS_BLOB";
const BLOB_KEY_ID_LEN = 1;
// The private-data-sources manifest carries plaintext VPC DB credentials and
// selects which binding a PDS call reaches. It must reach neither process.env
// (user code could overwrite it and forge the manifest) nor any user-reachable
// global. It goes only into the private store above, which manifest.ts reads.
const MANIFEST_KEY = "BASE44_PRIVATE_DATA_SOURCES";

/** Why a pull failed. Closed enum; the backend maps anything else to `malformed`. */
export type ActivationReason =
  | "challenge_missing"
  | "url_missing"
  | "key_missing"
  | "url_not_https"
  | "endpoint_unreachable"
  | "endpoint_timeout"
  | "endpoint_400"
  | "endpoint_401"
  | "endpoint_409"
  | "endpoint_429"
  | "endpoint_4xx"
  | "endpoint_5xx"
  | "response_malformed"
  | "blob_missing"
  | "blob_unreadable"
  | "internal";
// Properties of the script's bindings, so no retry can fix them: they hold for the
// isolate's lifetime. `challenge_missing` and `endpoint_409` belong to one request
// and answer only it; every other reason cools down for PULL_COOLDOWN_MS.
const LATCHED_REASONS: readonly ActivationReason[] = [
  "url_missing",
  "key_missing",
  "url_not_https",
  "blob_missing",
  "blob_unreadable",
];

// Primordials captured at module load, before any user code. The request/response
// boundary runs on warm requests, after user code, so it resolves no global at call
// time; `m.call(obj)` would look `.call` up then, so every method is uncurried (bound).
const _uncurry = Function.prototype.bind.bind(Function.prototype.call) as <
  F extends (this: any, ...args: any[]) => any,
>(
  fn: F,
) => (self: ThisParameterType<F>, ...args: Parameters<F>) => ReturnType<F>;
const _subtle = crypto.subtle;
const _subtleImportKey = _subtle.importKey.bind(_subtle);
const _subtleDecrypt = _subtle.decrypt.bind(_subtle);
const _subtleSign = _subtle.sign.bind(_subtle);
const _subtleDigest = _subtle.digest.bind(_subtle);
// Native fetch: this module evaluates before the entry's body installs the
// static-egress and telemetry fetch wrappers, so the pull never rides the
// customer's STATIC_EGRESS binding (platform traffic must not depend on a
// customer resource) and is invisible to the telemetry census.
const _fetch = globalThis.fetch.bind(globalThis);
const _abortTimeout = AbortSignal.timeout.bind(AbortSignal);
const _DateNow = Date.now;
const _JSONparse = JSON.parse;
const _TextDecoder = TextDecoder;
const _TextEncoder = TextEncoder;
// The PROTOTYPE METHODS too, not just the constructors: `new TextDecoder().decode(x)`
// resolves `decode` on the prototype at call time, so patching
// TextDecoder.prototype.decode would still intercept the decrypted plaintext.
const _decodeUtf8 = _uncurry(TextDecoder.prototype.decode);
const _encodeUtf8 = _uncurry(TextEncoder.prototype.encode);
const _Uint8Array = Uint8Array;
const _atob = atob;
const _btoa = btoa;
const _ObjectEntries = Object.entries;
// The request/response boundary. Constructors, prototype methods AND the
// accessors: `response.headers` resolves a getter on Response.prototype, so
// patching that getter alone would be enough to hide a forged header. All
// uncurried (see _uncurry): invoked as `_headersGet(obj, name)`, never `.call`.
const _Headers = Headers;
const _Request = Request;
const _Response = Response;
const _headersGet = _uncurry(Headers.prototype.get);
const _headersAppend = _uncurry(Headers.prototype.append);
const _headersEntries = _uncurry(Headers.prototype.entries);
const _resText = _uncurry(Response.prototype.text);
// Header iteration without the array/iterator protocols user code can patch:
// drive next() by captured reference and index step.value positionally.
const _iterNext = _uncurry(Object.getPrototypeOf(new Headers().entries()).next);
// Walk the chain: workerd puts `body` on Body.prototype, not on
// Request/Response.prototype, so a single getOwnPropertyDescriptor misses it.
function accessor<T>(proto: object, name: string): ((self: unknown) => T) | undefined {
  for (let o: object | null = proto; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d?.get) return _uncurry(d.get) as (self: unknown) => T;
  }
  return undefined;
}
const _reqHeaders = accessor<Headers>(Request.prototype, "headers")!;
const _resHeaders = accessor<Headers>(Response.prototype, "headers")!;
const _resStatus = accessor<number>(Response.prototype, "status")!;
const _resStatusText = accessor<string>(Response.prototype, "statusText")!;
const _resBody = accessor<ReadableStream | null>(Response.prototype, "body")!;
// workerd extension; null on a response that carries no socket.
const _resWebSocket = accessor<unknown>(Response.prototype, "webSocket");
// Lowercase: Headers.entries() yields lowercased names, and comparing them
// must not go through a patchable String.prototype.toLowerCase. The v3 envelope
// is never meant for a pull shim, so it comes off with the challenge.
const RUNTIME_SECRETS_HEADER_LC = "base44-runtime-secrets";
const INBOUND_HEADERS_LC = ["base44-activation-challenge", RUNTIME_SECRETS_HEADER_LC];
// Every header the shim emits, plus the v3 signal it never emits; a copy on a
// handler response is forged. Lowercase serves both uses: Headers.get ignores
// case, entries() yields lowercase names.
const SHIM_RESPONSE_HEADERS_LC = [
  "x-base44-activation-error",
  "x-base44-activation",
  "x-base44-activation-digest",
  "x-base44-needs-activation",
];

// workerd mirrors every string binding into process.env, which Deno.env,
// process.env and the secrets bridge all read. The pull bindings come off it
// here, at shim load — before the entry body runs and before any user import.
delete process.env[ACTIVATION_URL_ENV];
delete process.env[ACTIVATION_KEY_ENV];

/** Index loop: Array.prototype.includes is patchable and this runs on the boundary. */
function listHas(list: readonly string[], value: string): boolean {
  for (let i = 0; i < list.length; i++) if (list[i] === value) return true;
  return false;
}

/** A copy of `src` minus the names in `dropLowercased`, built only from captured references. */
function headersWithout(src: Headers, dropLowercased: readonly string[]): Headers {
  const out = new _Headers();
  const it = _headersEntries(src);
  for (;;) {
    const step = _iterNext(it);
    if (step.done) break;
    // Positional, not destructured: array destructuring reads Symbol.iterator.
    if (!listHas(dropLowercased, step.value[0])) {
      _headersAppend(out, step.value[0], step.value[1]);
    }
  }
  return out;
}

class ActivationError extends Error {
  constructor(readonly reason: ActivationReason) {
    super(reason);
  }
}

function reasonOf(e: unknown): ActivationReason {
  return e instanceof ActivationError ? e.reason : "internal";
}

/** Run one phase of the pull; any rejection becomes `reason` (an ActivationError passes through). */
async function phase<T>(reason: ActivationReason, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw e instanceof ActivationError ? e : new ActivationError(reason);
  }
}

// Install-once latch (see installOnce): no clock, so a patched Date.now
// cannot make stale credentials look fresh or suppress a first activation.
let installed = false;
let pendingInstall: Promise<boolean> | null = null;
let installChain: Promise<unknown> = Promise.resolve();
let latchedReason: ActivationReason | null = null;
let cooldownReason: ActivationReason | null = null;
let nextPullAt = 0;

/** proof = HMAC-SHA256(activation key, "cf-activation-proof-v1." || challenge), b64url. */
export async function activationProof(activationKeyB64: string, challenge: string): Promise<string> {
  const key = await _subtleImportKey(
    "raw",
    fromBase64Url(activationKeyB64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = _encodeUtf8(new _TextEncoder(), PROOF_CONTEXT + challenge);
  return toBase64Url(new _Uint8Array(await _subtleSign("HMAC", key, message)));
}

function endpointReason(status: number): ActivationReason {
  switch (status) {
    case 400:
      return "endpoint_400";
    case 401:
      return "endpoint_401";
    case 409:
      return "endpoint_409";
    case 429:
      return "endpoint_429";
  }
  if (status >= 400 && status < 500) return "endpoint_4xx";
  if (status >= 500 && status < 600) return "endpoint_5xx";
  // 1xx/3xx (redirect: "manual" surfaces the 3xx itself): not this protocol.
  return "response_malformed";
}

/** The pull: prove possession of the activation key over the challenge;
 *  receive the data key. */
async function pullDataKey(challenge: string, env: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const bindings = (env ?? {}) as Record<string, unknown>;
  const url = bindings[ACTIVATION_URL_ENV];
  const activationKeyB64 = bindings[ACTIVATION_KEY_ENV];
  if (typeof url !== "string" || !url) throw new ActivationError("url_missing");
  if (typeof activationKeyB64 !== "string" || !activationKeyB64) {
    throw new ActivationError("key_missing");
  }
  if (!url.startsWith("https://")) throw new ActivationError("url_not_https");
  const headers = new _Headers();
  _headersAppend(headers, ACTIVATION_CHALLENGE_HEADER, challenge);
  _headersAppend(
    headers,
    ACTIVATION_PROOF_HEADER,
    await activationProof(activationKeyB64, challenge),
  );
  // One deadline covers head and body: a hung endpoint would otherwise hold
  // every request riding pendingInstall until the backend's own 300 s timeout.
  const signal = _abortTimeout(PULL_TIMEOUT_MS);
  const transport = (): ActivationReason =>
    signal.aborted ? "endpoint_timeout" : "endpoint_unreachable";
  let res: Response;
  try {
    res = await _fetch(url, { method: "POST", headers, redirect: "manual", signal });
  } catch {
    throw new ActivationError(transport());
  }
  // Classified by status alone; an error body (`{"error": ...}`) is never read.
  const status = _resStatus(res);
  if (status !== 200) throw new ActivationError(endpointReason(status));
  let body: string;
  try {
    body = await _resText(res);
  } catch {
    throw new ActivationError(transport());
  }
  if (body.length > PULL_BODY_MAX_CHARS) throw new ActivationError("response_malformed");
  // `{"key": b64url(32 bytes)}`; any other shape is not this protocol.
  const parsed: unknown = await phase("response_malformed", () => _JSONparse(body));
  const keyB64 =
    parsed !== null && typeof parsed === "object" ? (parsed as { key?: unknown }).key : undefined;
  if (typeof keyB64 !== "string") throw new ActivationError("response_malformed");
  const dataKey = await phase("response_malformed", () => fromBase64Url(keyB64));
  if (dataKey.length !== DATA_KEY_LEN) throw new ActivationError("response_malformed");
  return dataKey;
}

/** Open the blob this script was DEPLOYED with under the data key and install
 *  its secrets. */
async function installFromDataKey(dataKeyBytes: BufferSource, env: unknown): Promise<void> {
  const bindings = (env ?? {}) as Record<string, unknown>;
  const appId = bindings.BASE44_APP_ID;
  const aad = _encodeUtf8(new _TextEncoder(), typeof appId === "string" ? appId : "");
  // Read the blob from the bindings and reassemble. A gap ends the sequence: a
  // partially written set decodes to truncated ciphertext and AES-GCM fails
  // closed below.
  let blobB64 = "";
  for (let i = 0; ; i++) {
    const part = bindings[`${BLOB_BINDING_PREFIX}_${i}`];
    if (typeof part !== "string") break;
    blobB64 += part;
  }
  // A runtime-secrets script always carries the blob, so this is a deploy-side
  // defect: fail, and let the backend surface a non-billable 503 instead of
  // running user code with an empty env.
  if (blobB64 === "") throw new ActivationError("blob_missing");
  const secrets = await phase("blob_unreadable", async () => {
    const blob = fromBase64Url(blobB64);
    // Non-extractable: the key opens the blob and never leaves WebCrypto.
    const dataKey = await _subtleImportKey("raw", dataKeyBytes, "AES-GCM", false, ["decrypt"]);
    const plaintext = await _subtleDecrypt(
      {
        name: "AES-GCM",
        iv: blob.slice(BLOB_KEY_ID_LEN, BLOB_KEY_ID_LEN + NONCE_LEN),
        additionalData: aad,
      },
      dataKey,
      blob.slice(BLOB_KEY_ID_LEN + NONCE_LEN),
    );
    const payload: unknown = _JSONparse(
      _decodeUtf8(new _TextDecoder(), inflateSync(new _Uint8Array(plaintext))),
    );
    return payload && typeof payload === "object" && (payload as { secrets?: unknown }).secrets
      ? (payload as { secrets: Record<string, unknown> }).secrets
      : {};
  });
  // The manifest goes to the private store (read only by manifest.ts), NOT
  // process.env or a global — keep it off every user-reachable surface.
  const manifestValue = secrets[MANIFEST_KEY];
  // `""`, never `undefined`, when the payload carries no manifest: manifest.ts
  // treats any DEFINED value as handshake-delivered and returns []. `undefined`
  // would fall through to the Worker BINDING — unfiltered and unpinned — so an
  // app that removed its last data source could keep resolving a stale manifest
  // and its plaintext credentials.
  setRuntimeManifest(typeof manifestValue === "string" ? manifestValue : "");
  // No unset pass: this runs once per isolate, so there is never a previous
  // payload to diff against. A deleted secret reaches the isolate by NOT being
  // in this payload, and existing isolates are rolled by the generation-nonce
  // version bump on secret change.
  for (const [key, value] of _ObjectEntries(secrets)) {
    if (key !== MANIFEST_KEY && typeof value === "string") process.env[key] = value;
  }
  installed = true;
}

/** Why this isolate may not pull now: a latched fault, or a cooldown after a miss. */
function gateClosed(): ActivationReason | null {
  if (latchedReason) return latchedReason;
  return _DateNow() < nextPullAt ? cooldownReason : null;
}

/** Pull and install at most once per isolate, before any user code: the realm is
 *  shared with it, so a re-install could never be made safe. Attempts run one at a
 *  time on `installChain` and each re-checks the gate its predecessor's failure set,
 *  so a request that rode a failed pull can start its own only if the gate is open.
 *  Resolves true when THIS attempt installed. */
function installOnce(challenge: string, env: unknown): Promise<boolean> {
  const run = installChain.then(async () => {
    if (installed) return false;
    const closed = gateClosed();
    if (closed) throw new ActivationError(closed);
    try {
      await installFromDataKey(await pullDataKey(challenge, env), env);
      return true;
    } catch (e) {
      const reason = reasonOf(e);
      if (listHas(LATCHED_REASONS, reason)) {
        latchedReason = reason;
      } else if (reason !== "endpoint_409") {
        cooldownReason = reason;
        nextPullAt = _DateNow() + PULL_COOLDOWN_MS;
      }
      // Reason code only — never secret material.
      console.error(`Base44 runtime-secrets activation failed: ${reason}`);
      throw new ActivationError(reason);
    }
  });
  installChain = run.then(undefined, () => {}); // a failed attempt must not wedge the chain
  pendingInstall = run;
  const clear = () => {
    if (pendingInstall === run) pendingInstall = null;
  };
  run.then(clear, clear);
  return run;
}

/** What the gate decided for one request. */
export interface ActivationOutcome {
  /** Emit immediately — no user code may run — or `null` to proceed. */
  response: Response | null;
  /** Wall ms of pull + install; set only on the request that performed this isolate's install. */
  pulledMs: number | null;
  /** The marker's digest, on that same request. */
  markerDigest: string | null;
}

const PROCEED: ActivationOutcome = Object.freeze({ response: null, pulledMs: null, markerDigest: null });

async function digestOf(text: string): Promise<string> {
  return toBase64Url(new _Uint8Array(await _subtleDigest("SHA-256", _encodeUtf8(new _TextEncoder(), text))));
}

/** b64url(SHA-256("cf-activation-error-v1." || reason || "." || challenge)). */
export function errorDigest(reason: string, challenge: string): Promise<string> {
  return digestOf(`${ERROR_DIGEST_CONTEXT}${reason}.${challenge}`);
}

/** b64url(SHA-256("cf-activation-marker-v1." || challenge)). */
export function markerDigest(challenge: string): Promise<string> {
  return digestOf(`${MARKER_DIGEST_CONTEXT}${challenge}`);
}

/** Without a digest (no challenge, or WebCrypto failed) the backend treats the 503
 *  as the script's own, billable: the caller sees a 503 either way. */
async function failure(reason: ActivationReason, challenge: string | null): Promise<ActivationOutcome> {
  const headers = new _Headers();
  _headersAppend(headers, ACTIVATION_ERROR_HEADER, reason);
  if (challenge) {
    try {
      _headersAppend(headers, ACTIVATION_DIGEST_HEADER, await errorDigest(reason, challenge));
    } catch {
      // unbound: see above
    }
  }
  _headersAppend(headers, "Cache-Control", "no-store");
  return { response: new _Response(null, { status: 503, headers }), pulledMs: null, markerDigest: null };
}

/** Gate a request on activation, given the challenge `takeActivationChallenge`
 *  read off it. A warm isolate passes straight through; a cold one pulls the
 *  data key (once per isolate — concurrent requests ride the same install) or
 *  answers a 503 with the reason it could not. Nothing escapes: an unclassified
 *  failure is a 503 `internal`, never a 500. Call `withoutActivationHeaders` on
 *  the handler's response. */
export async function ensureActivation(challenge: string | null, env: unknown): Promise<ActivationOutcome> {
  if (installed) return PROCEED;
  try {
    if (pendingInstall) {
      // A concurrent request is mid-install: ride it. If it fails, its failure has
      // already set the latch or cooldown this request sees below.
      try {
        await pendingInstall;
        return PROCEED;
      } catch {
        // decide as if this request had arrived first
      }
    }
    if (latchedReason) return await failure(latchedReason, challenge);
    // The backend attaches one to every request it forwards, so its absence
    // says nothing about the next request: no latch, no cooldown.
    if (!challenge) return await failure("challenge_missing", null);
    const closed = gateClosed();
    if (closed) return await failure(closed, challenge);
    const started = _DateNow();
    // Only the request whose pull installed stamps the marker.
    if (!(await installOnce(challenge, env))) return PROCEED;
    const pulledMs = _DateNow() - started;
    let digest: string | null = null;
    try {
      digest = await markerDigest(challenge);
    } catch {
      // an unbound marker is only an uncounted success
    }
    return { response: null, pulledMs, markerDigest: digest };
  } catch (e) {
    return failure(reasonOf(e), challenge);
  }
}

/** Read the challenge off the request and hand back a request without it. The
 *  ENTRY's first statement, before any other header read: on a warm isolate
 *  user code may have replaced `Headers.prototype.get`, and an entry call like
 *  `request.headers.get("Base44-Function-Name")` would hand it the live
 *  headers — challenge included. The value lives in the entry's closure until
 *  `ensureActivation` consumes it; every operation here is a captured
 *  reference. */
export function takeActivationChallenge(request: Request): { challenge: string | null; request: Request } {
  const raw = _reqHeaders(request);
  const challenge = _headersGet(raw, ACTIVATION_CHALLENGE_HEADER);
  if (challenge === null && _headersGet(raw, RUNTIME_SECRETS_HEADER_LC) === null) return { challenge, request };
  return { challenge, request: new _Request(request, { headers: headersWithout(raw, INBOUND_HEADERS_LC) }) };
}

/** Strip the shim's own headers from a handler response and stamp the installing
 *  request's marker. Hygiene: the backend trusts neither header without a digest
 *  of the request's challenge, which user code never sees, and refuses the v3
 *  signal from a pull-shim script id. */
export function withoutActivationHeaders(response: Response, activation: ActivationOutcome): Response {
  const raw = _resHeaders(response);
  let forged = false;
  for (let i = 0; i < SHIM_RESPONSE_HEADERS_LC.length; i++) {
    if (_headersGet(raw, SHIM_RESPONSE_HEADERS_LC[i]) !== null) forged = true;
  }
  if (!forged) {
    if (activation.pulledMs === null) return response;
    // In place when mutable: a rebuilt Response drops init-only options (encodeBody, cf).
    try {
      stampMarker(raw, activation);
      return response;
    } catch {
      // immutable (a fetch pass-through): the rebuild below carries the marker
    }
  }
  const headers = headersWithout(raw, SHIM_RESPONSE_HEADERS_LC);
  if (activation.pulledMs !== null) stampMarker(headers, activation);
  return new _Response(_resBody(response), {
    status: _resStatus(response),
    statusText: _resStatusText(response),
    headers,
    // Preserved or a 101 upgrade would fail to reconstruct.
    webSocket: _resWebSocket ? _resWebSocket(response) : undefined,
  } as ResponseInit);
}

function stampMarker(headers: Headers, activation: ActivationOutcome): void {
  _headersAppend(headers, ACTIVATION_MARKER_HEADER, `pulled;ms=${activation.pulledMs}`);
  if (activation.markerDigest) _headersAppend(headers, ACTIVATION_DIGEST_HEADER, activation.markerDigest);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return _btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = _atob(padded);
  const bytes = new _Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
