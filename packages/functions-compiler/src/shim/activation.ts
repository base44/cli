// Runtime-secrets activation: the platform delivers app secrets into isolate
// memory via an encrypted handshake instead of baking them into the script as
// secret_text bindings. Injected into a bundle ONLY when the backend deploys it
// in runtime-secrets mode (`runtimeSecrets` bundle flag) — old-mode bundles are
// byte-identical to before.
//
// Protocol (keep in sync with backend/app/cloudflare_functions/activation_handshake.py):
//   - Cold isolate (nothing installed yet): respond 503 with
//     `X-Base44-Needs-Activation: b64url(raw P-256 pubkey)` BEFORE importing any
//     user code, so the backend can safely re-send the request.
//   - The re-sent request carries the envelope in `Base44-Runtime-Secrets`
//     (header channel ONLY — the key always rides the request that will run,
//     so whichever isolate receives it is the right one by construction):
//       b64url(backendPub(65) || k(1) || k*[nonce_i(12) || wrap_i(48)])
//     wrap_i is the app DATA KEY sealed to isolate key i (KEK_i = ECDH P-256 +
//     HKDF-SHA256(info="base44-runtime-secrets-v1")), AES-256-GCM with
//     AAD = BASE44_APP_ID. The envelope is CONSTANT SIZE: it carries a 32-byte
//     key, never the secrets, so it cannot outgrow CF's header budget.
//     Multiple recipients exist because the backend seals to every isolate key
//     it saw while retrying: a re-send can land on a different cold isolate
//     (no WfP affinity), and covering them all is what makes the loop converge
//     instead of ping-ponging between two cold isolates. This isolate cannot
//     know its position, so it derives its KEK once and tries every wrap block
//     until one authenticates.
//   - The SECRETS themselves are baked into this script as an encrypted blob,
//     split across `BASE44_SECRETS_BLOB_<n>` bindings (CF caps one value at
//     5 KB). We concatenate them in index order, then decrypt with the data
//     key: keyId(1) || nonce(12) || AES-256-GCM(deflated JSON), same AAD.
//     Cloudflare stores only ciphertext it has no key for.
//   - Decrypted+inflated env installs into `process.env` — `Deno.env` reads it
//     live (@deno/shim-deno backs env with process.env) and npm SDKs read it
//     directly.
//
// The keypair exists only in this isolate's memory; nothing here is persisted.
//
// The platform scrubs client copies of these protocol headers on the way in
// (runtime_api.py's inbound scrub, next to the existing
// base44-dispatcher-authorization scrub). With the header channel alone this
// is hygiene rather than a load-bearing defense — a client-supplied
// `Base44-Runtime-Secrets` is ignored by a warm isolate (installOnce
// short-circuits) and merely re-signals on a cold one, and installing anything
// still requires ECDH + AES-GCM with the app-id AAD. Keep any new protocol
// header on that scrub list anyway.

// A static module import, like node:async_hooks in the deno shim: external in
// the bundle, provided by workerd's nodejs_compat. Import bindings can't be
// reassigned by user code, so unlike the globals below this needs no capture.
import { inflateSync } from "node:zlib";

// The manifest goes into the private store shared with manifest.ts (one bundle
// instance; see runtime-manifest-store). Imported via the virtual specifier so
// build-shim leaves it external and the FINAL app compile dedupes it with
// manifest.ts's `./runtime-manifest-store` — NEVER a user-reachable global.
import { setRuntimeManifest } from "base44:private-data-sources/runtime-manifest-store";

export const NEEDS_ACTIVATION_HEADER = "X-Base44-Needs-Activation";
export const RUNTIME_SECRETS_HEADER = "Base44-Runtime-Secrets";
const HKDF_INFO = "base44-runtime-secrets-v1";
const BACKEND_PUBKEY_LEN = 65; // uncompressed P-256 point
const NONCE_LEN = 12;
const DATA_KEY_LEN = 32;
// nonce_i(12) + AES-GCM(dataKey 32 + tag 16)
const WRAP_BLOCK_LEN = NONCE_LEN + DATA_KEY_LEN + 16;
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

// Primordials captured at MODULE LOAD, which happens before any user code:
// this module is a static import of the generated entry, while the user module
// is imported lazily inside fetch. Every global below is mutable and shares the
// isolate's realm with user code.
//
// For install() these are belt-and-braces — it only ever runs before user code
// (see installOnce), and never re-installing is the primary defense. For the
// REQUEST/RESPONSE boundary below they are the primary defense, because that
// code runs on warm requests, after the handler has had a chance to patch
// prototypes. A handler that makes the signal strip miss gets the backend to
// seal the app data key to a keypair the handler generated, and can then read
// the envelope off the replay and decrypt the blob bindings — which would hand
// user code the private-data-source manifest this shim keeps out of its reach.
// So: no global may be resolved at call time on either path.
const _subtle = crypto.subtle;
const _subtleGenerateKey = _subtle.generateKey.bind(_subtle);
const _subtleExportKey = _subtle.exportKey.bind(_subtle);
const _subtleImportKey = _subtle.importKey.bind(_subtle);
const _subtleDeriveBits = _subtle.deriveBits.bind(_subtle);
const _subtleDecrypt = _subtle.decrypt.bind(_subtle);
const _JSONparse = JSON.parse;
const _TextDecoder = TextDecoder;
const _TextEncoder = TextEncoder;
// The PROTOTYPE METHODS too, not just the constructors: `new TextDecoder().decode(x)`
// resolves `decode` on the prototype at call time, so patching
// TextDecoder.prototype.decode would still intercept the decrypted plaintext.
const _decodeUtf8 = TextDecoder.prototype.decode;
const _encodeUtf8 = TextEncoder.prototype.encode;
const _Uint8Array = Uint8Array;
const _atob = atob;
const _btoa = btoa;
const _DOMException = DOMException;
const _ObjectEntries = Object.entries;
// The request/response boundary. Constructors, prototype methods AND the
// accessors: `response.headers` resolves a getter on Response.prototype, so
// patching that getter alone would be enough to hide a forged signal.
const _Headers = Headers;
const _Request = Request;
const _Response = Response;
const _headersGet = Headers.prototype.get;
const _headersAppend = Headers.prototype.append;
const _headersEntries = Headers.prototype.entries;
// Header iteration without the array/iterator protocols user code can patch:
// drive next() by captured reference and index step.value positionally.
const _iterNext = Object.getPrototypeOf(new Headers().entries()).next;
// Walk the chain: workerd puts `body` on Body.prototype, not on
// Request/Response.prototype, so a single getOwnPropertyDescriptor misses it.
function accessor<T>(proto: object, name: string): ((this: unknown) => T) | undefined {
  for (let o: object | null = proto; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d?.get) return d.get as (this: unknown) => T;
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
// must not go through a patchable String.prototype.toLowerCase.
const NEEDS_ACTIVATION_HEADER_LC = "x-base44-needs-activation";
const RUNTIME_SECRETS_HEADER_LC = "base44-runtime-secrets";

/** A copy of `src` minus `dropLowercased`, built only from captured references. */
function headersWithout(src: Headers, dropLowercased: string): Headers {
  const out = new _Headers();
  const it = _headersEntries.call(src);
  for (;;) {
    const step = _iterNext.call(it);
    if (step.done) break;
    // Positional, not destructured: array destructuring reads Symbol.iterator.
    if (step.value[0] !== dropLowercased) _headersAppend.call(out, step.value[0], step.value[1]);
  }
  return out;
}

let keyPairPromise: Promise<CryptoKeyPair> | null = null;
// Install-once latch (see installOnce): no clock, so a patched Date.now
// cannot make stale credentials look fresh or suppress a first activation.
let installed = false;
let pendingInstall: Promise<void> | null = null;
let installChain: Promise<void> = Promise.resolve();

function getKeyPair(): Promise<CryptoKeyPair> {
  // Non-extractable private key: deriveBits only, never leaves the isolate.
  // Clear a REJECTED promise: `??=` would cache the rejection, and then this
  // isolate could never signal again — needsActivationResponse() would reject
  // out of ensureActivation (including from its catch blocks), so every later
  // request 500s instead of 503-signalling and the backend never sees a
  // handshake to retry. The assignment is synchronous and this handler runs
  // later, so clearing here cannot race the `??=`.
  keyPairPromise ??= _subtleGenerateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  ).catch((e) => {
    keyPairPromise = null;
    throw e;
  });
  return keyPairPromise;
}

async function needsActivationResponse(): Promise<Response> {
  const { publicKey } = await getKeyPair();
  const raw = await _subtleExportKey("raw", publicKey);
  return new Response(null, {
    status: 503,
    headers: {
      [NEEDS_ACTIVATION_HEADER]: toBase64Url(new _Uint8Array(raw)),
      "Cache-Control": "no-store",
    },
  });
}

async function install(envelopeB64: string, env: unknown): Promise<void> {
  const envelope = fromBase64Url(envelopeB64);
  const backendPub = envelope.slice(0, BACKEND_PUBKEY_LEN);
  const recipientCount = envelope[BACKEND_PUBKEY_LEN];

  const { privateKey } = await getKeyPair();
  const peer = await _subtleImportKey(
    "raw",
    backendPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await _subtleDeriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const hkdfKey = await _subtleImportKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const keyBits = await _subtleDeriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new _Uint8Array(0),
      info: _encodeUtf8.call(new _TextEncoder(), HKDF_INFO),
    },
    hkdfKey,
    256,
  );
  const kek = await _subtleImportKey("raw", keyBits, "AES-GCM", false, ["decrypt"]);

  const appId = (env as Record<string, unknown> | undefined)?.BASE44_APP_ID;
  const aad = _encodeUtf8.call(new _TextEncoder(), typeof appId === "string" ? appId : "");

  // The KEK (above) is fixed by OUR private key; only the wrap block that was
  // encrypted to this isolate's key authenticates under it. Try each — the
  // envelope carries one block per isolate the backend saw across this
  // request's retries, so this isolate can't know its position and must
  // never assume a count bound.
  let dataKeyBytes: ArrayBuffer | null = null;
  for (let i = 0; i < recipientCount && dataKeyBytes === null; i++) {
    const blockStart = BACKEND_PUBKEY_LEN + 1 + i * WRAP_BLOCK_LEN;
    const wrapNonce = envelope.slice(blockStart, blockStart + NONCE_LEN);
    const wrapped = envelope.slice(blockStart + NONCE_LEN, blockStart + WRAP_BLOCK_LEN);
    try {
      dataKeyBytes = await _subtleDecrypt(
        { name: "AES-GCM", iv: wrapNonce, additionalData: aad },
        kek,
        wrapped,
      );
    } catch {
      // Not our block (GCM auth failure) — try the next.
    }
  }
  if (dataKeyBytes === null) {
    // No block was sealed to this isolate's key (or wrong app AAD): throw so
    // ensureActivation re-signals with OUR key and the backend adds us to the
    // recipient set.
    throw new _DOMException("no wrap block for this isolate", "OperationError");
  }

  // The data key opens the blob this script was DEPLOYED with — read it from
  // the bindings and reassemble. A gap ends the sequence: a partially written
  // set decodes to truncated ciphertext and AES-GCM fails closed below.
  const bindings = (env ?? {}) as Record<string, unknown>;
  let blobB64 = "";
  for (let i = 0; ; i++) {
    const part = bindings[`${BLOB_BINDING_PREFIX}_${i}`];
    if (typeof part !== "string") break;
    blobB64 += part;
  }
  if (blobB64 === "") {
    // Nothing to open. A runtime-secrets script always carries the blob, so
    // this is a deploy-side defect rather than a wrong-isolate envelope — but
    // treat it the same way: fail, and let the backend surface a non-billable
    // 503 instead of running user code with an empty env.
    throw new _DOMException("no secret blob bindings on this script", "OperationError");
  }
  const blob = fromBase64Url(blobB64);
  const blobNonce = blob.slice(BLOB_KEY_ID_LEN, BLOB_KEY_ID_LEN + NONCE_LEN);
  const blobCiphertext = blob.slice(BLOB_KEY_ID_LEN + NONCE_LEN);

  const dataKey = await _subtleImportKey("raw", dataKeyBytes, "AES-GCM", false, ["decrypt"]);
  const plaintext = await _subtleDecrypt(
    { name: "AES-GCM", iv: blobNonce, additionalData: aad },
    dataKey,
    blobCiphertext,
  );

  const payload: unknown = _JSONparse(
    _decodeUtf8.call(new _TextDecoder(), inflateSync(new _Uint8Array(plaintext))),
  );
  const secrets =
    payload && typeof payload === "object" && (payload as { secrets?: unknown }).secrets
      ? ((payload as { secrets: Record<string, unknown> }).secrets)
      : {};
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

/** Install at most ONCE per isolate, and only before any user code has run.
 *
 *  This is a security boundary, not an optimization. Every global `install()`
 *  touches is mutable and shares the isolate's realm with user code, and the
 *  language offers no way to make a later call immune: capturing JSON.parse
 *  invites patching TextDecoder.prototype.decode, capturing that invites
 *  patching Function.prototype.call, and so on without end. So we never install
 *  a second time. The first install is safe by construction — this module is a
 *  static import of the generated entry and the gate runs before the user module
 *  is imported — and after that the answer to "is a re-install safe?" is
 *  permanently "we don't do one".
 *
 *  Rotation does not depend on re-installing: a secret change PUTs the
 *  BASE44_SECRETS_GENERATION nonce on the script (see on_secret_change), which
 *  bumps the Worker version, so Cloudflare rolls these isolates and the next one
 *  installs the new values on its own first request.
 *
 *  Concurrent first activations still serialize through the chain so two
 *  in-flight envelopes can't interleave their writes, and the in-flight install
 *  is published as `pendingInstall` so a waiting request rides it instead of
 *  paying its own round trip. */
function installOnce(envelopeB64: string, env: unknown): Promise<void> {
  if (installed) return Promise.resolve();
  const afterPrevious = installChain.then(undefined, () => {});
  const run = afterPrevious.then(() => (installed ? undefined : install(envelopeB64, env)));
  installChain = run.then(undefined, () => {}); // a failed install must not wedge the chain
  pendingInstall = run;
  const clear = () => {
    if (pendingInstall === run) pendingInstall = null;
  };
  run.then(clear, clear);
  return run;
}

/** Gate a request on the activation handshake. Returns the needs-activation
 *  `Response` to emit immediately (no user code may run), or `null` to proceed.
 *  Call `withoutRuntimeSecretsHeader` on the request before user code sees it. */
export async function ensureActivation(request: Request, env: unknown): Promise<Response | null> {
  const header = _headersGet.call(_reqHeaders.call(request), RUNTIME_SECRETS_HEADER);
  if (header) {
    try {
      await installOnce(header, env);
      return null;
    } catch (e) {
      // Wrong isolate's envelope after a re-route, or a corrupt blob. Re-signal
      // with OUR pubkey. Reason code only — never secret material.
      console.error(
        `Base44 runtime-secrets activation failed, re-signaling: ${(e as Error)?.name ?? "error"}`,
      );
      return needsActivationResponse();
    }
  }
  if (installed) return null;
  if (pendingInstall) {
    // A concurrent request is mid-install — ride it instead of a needless round trip.
    try {
      await pendingInstall;
    } catch {
      // The installer re-signals on its own request; we signal for ours below.
    }
    if (installed) return null;
  }
  return needsActivationResponse();
}

/** Strip the encrypted envelope so user code can't capture, log, or replay it.
 *  Runs on warm requests too, so every operation is a captured reference. */
export function withoutRuntimeSecretsHeader(request: Request): Request {
  const raw = _reqHeaders.call(request);
  if (_headersGet.call(raw, RUNTIME_SECRETS_HEADER) === null) return request;
  return new _Request(request, { headers: headersWithout(raw, RUNTIME_SECRETS_HEADER_LC) });
}

/** Strip the activation signal from user-handler responses. The genuine signal
 *  is only ever emitted BEFORE user code runs, and this wraps the handler
 *  response only — so a copy reaching here is forged, and letting it through
 *  would make the backend re-execute a request whose side effects already ran
 *  AND seal the app data key to a keypair the handler chose. The header lookup
 *  therefore uses a captured Headers.prototype.get on the headers object read
 *  through a captured accessor: a patched `has`/`get`/`headers` cannot hide it. */
export function withoutActivationSignal(response: Response): Response {
  const raw = _resHeaders.call(response);
  if (_headersGet.call(raw, NEEDS_ACTIVATION_HEADER) === null) return response;
  return new _Response(_resBody.call(response), {
    status: _resStatus.call(response),
    statusText: _resStatusText.call(response),
    headers: headersWithout(raw, NEEDS_ACTIVATION_HEADER_LC),
    // Preserved or a 101 upgrade would fail to reconstruct.
    webSocket: _resWebSocket ? _resWebSocket.call(response) : undefined,
  } as ResponseInit);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return _btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = _atob(padded);
  const bytes = new _Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
