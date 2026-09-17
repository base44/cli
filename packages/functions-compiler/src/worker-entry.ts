/**
 * Assembles user functions into the input the bundler compiles: the user
 * sources (passed through verbatim — the Deno resolver understands their
 * `npm:`/`jsr:`/`https:` specifiers) plus an injected shim and a generated
 * Worker entry. This is the layer that understands "functions" and "an app".
 */

import { readFileSync } from "node:fs";
import type { AppFunctionInput } from "./contracts.js";
import { DenoCompatError } from "./errors.js";
import { RUNTIME_CONTEXT_SPECIFIER } from "./esbuild/runtime-context-virtual.js";
import { TELEMETRY_PATCH, TELEMETRY_STORE_FIELDS } from "./telemetry.js";
import { COMPILER_VERSION } from "./version.js";

// Pre-built by scripts/build-shim.ts; regenerate it after changing the shim.
// Read LAZILY, not at module load: build-shim.ts transitively imports this
// module through the esbuild plugins, and on a fresh checkout dist/ doesn't
// exist yet — a load-time read would crash the very script that produces these
// files (and only pass locally where dist/ already exists).
let _denoShimSource: string | undefined;
function denoShimSource(): string {
  _denoShimSource ??= readFileSync(
    new URL("../dist/deno-shim.mjs", import.meta.url),
    "utf8",
  );
  return _denoShimSource;
}
let _activationShimSource: string | undefined;
function activationShimSource(): string {
  _activationShimSource ??= readFileSync(
    new URL("../dist/activation-shim.mjs", import.meta.url),
    "utf8",
  );
  return _activationShimSource;
}

// Synthetic files injected into the bundle; asserted absent from user input.
export const SHIM_FILENAME = "__base44_deno_shim.mjs";
const ENTRY_FILENAME = "__base44_entry.mjs";
// Injected only for runtime-secrets bundles — old-mode output stays byte-identical.
export const ACTIVATION_FILENAME = "__base44_activation.mjs";
// Actor shim filename is also reserved (handled by actor-compat.ts).
const ACTOR_ENTRY_FILENAME = "__base44_actor_entry.mjs";

export interface PreparedWorker {
  entry: string;
  files: Record<string, string>;
  /** Prepended verbatim to the compiled module. Only the app path sets it. */
  banner?: string;
}

export function workerRuntimeFiles(): Record<string, string> {
  return { [SHIM_FILENAME]: denoShimSource() };
}

/** Shared console-patching prelude injected into every generated Worker entry.
 *  Exported so tests can build minimal bundles with the same patch applied. */
// Runs at module scope before any user code so module-level logs are captured.
// Generated entries import `_b44Context` from the private runtime module.
export const CONSOLE_PATCH = [
  "const _b44Orig = console.log;",
  "const _b44S = x => { if (x instanceof Error) return x.stack || x.message; try { return typeof x === 'string' ? x : (JSON.stringify(x) ?? String(x)); } catch (e) { return String(x); } };",
  "const _b44Fmt = (a) => {",
  "  if (typeof a[0] !== 'string' || !a[0].includes('%')) return a.map(_b44S).join(' ');",
  "  let i = 1;",
  "  const s = a[0].replace(/%([sdifoOc])/g, (_, t) => {",
  "    if (i >= a.length) return '%' + t;",
  "    const v = a[i++];",
  "    if (t === 'd' || t === 'i') { try { return String(Math.trunc(+v)); } catch(_) { return _b44S(v); } }",
  "    if (t === 'f') { try { return String(+v); } catch(_) { return _b44S(v); } }",
  "    if (t === 'c') return '';",
  "    return _b44S(v);",
  "  });",
  "  const tail = a.slice(i).map(_b44S).join(' ');",
  "  return tail ? s + ' ' + tail : s;",
  "};",
  // The store holds { env, fn, secrets, workerEnv, waitUntil }; fn is set only
  // by per-app bundles, where one script serves every function and log queries
  // need per-function attribution. `secrets` and `workerEnv` reference the
  // request's authoritative Worker env binding.
  "const _b44Wrap = (lvl, a) => { const _c = _b44Context() ?? {}; _b44Orig({ _b44_env: _c.env ?? 'preview', ...(_c.fn ? { _b44_function: _c.fn } : {}), level: lvl, message: _b44Fmt(a) }); };",
  "console.log = (...a) => _b44Wrap('info', a);",
  "console.info = (...a) => _b44Wrap('info', a);",
  "console.warn = (...a) => _b44Wrap('warn', a);",
  "console.error = (...a) => _b44Wrap('error', a);",
  "console.debug = (...a) => _b44Wrap('debug', a);",
  // Request-scoped background-work hook. Cloudflare cancels promises left
  // pending after the response unless they ride ctx.waitUntil, and user code
  // has no other path to ctx — expose it via the same store as env/fn so
  // functions can ack fast and finish work reliably afterwards. The global
  // reads the store per call, so concurrent requests get their own ctx.
  // `secrets` reads the request's Worker env binding the same way. Two filters:
  //  - reserved platform keys (the private-data-sources manifest, which carries
  //    plaintext VPC DB credentials) are denied — user code reaches data sources
  //    via the base44:private-data-sources/* imports, never the raw manifest;
  //  - only string values are returned, so non-secret bindings (Hyperdrive
  //    objects, etc.) stay hidden.
  // This global is the internal bridge behind the "base44:runtime" virtual
  // module (src/runtime/index.ts) — keep the two shapes in sync (the actor
  // shim installs the same bridge from the DO env: src/shim/actor.ts).
  "const _b44ReservedSecrets = new Set(['BASE44_ACTOR_PRIVATE_KEY', 'BASE44_ACTOR_PUBLIC_KEY', 'BASE44_ACTOR_SCRIPT_ID', 'BASE44_PRIVATE_DATA_SOURCES']);",
  // Coerce to a primitive string BEFORE the reserved-key check: a boxed
  // `new String('BASE44_PRIVATE_DATA_SOURCES')` fails Set.has (object identity)
  // but would coerce back to the reserved key on the `env[...]` lookup, leaking
  // the manifest. `String(n)` normalizes both the check and the lookup.
  "globalThis.Base44 = Object.assign(globalThis.Base44 ?? {}, { waitUntil: (p) => { const _c = _b44Context(); if (_c?.waitUntil) { _c.waitUntil(p); } else { Promise.resolve(p).catch(() => {}); } }, secrets: { get: (n) => { const _k = String(n); if (_b44ReservedSecrets.has(_k)) return undefined; const _v = _b44Context()?.secrets?.[_k]; return typeof _v === 'string' ? _v : undefined; } } });",
  // Supabase-compat alias so copy-pasted EdgeRuntime.waitUntil code works.
  "globalThis.EdgeRuntime = globalThis.EdgeRuntime ?? { waitUntil: (p) => globalThis.Base44.waitUntil(p) };",
].join("\n");

/** Assemble a single Deno function into a bundle-ready Worker. */
export async function prepareFunction(
  entry: string,
  files: Record<string, string>,
  postResponseTelemetry = false,
  runtimeSecrets = false,
): Promise<PreparedWorker> {
  assertNoReservedFilenames(files);
  return {
    entry: ENTRY_FILENAME,
    files: {
      ...userFiles(files),
      ...workerRuntimeFiles(),
      ...(runtimeSecrets
        ? { [ACTIVATION_FILENAME]: activationShimSource() }
        : {}),
      [ENTRY_FILENAME]: buildEntrySource(
        entry,
        postResponseTelemetry,
        runtimeSecrets,
      ),
    },
  };
}

/** One app function paired with the stable key its files and diagnostics are
 *  namespaced under (`fn_<index>`). The index is the function's original
 *  position so attribution stays correct across an exclude-and-rebuild. */
/** Bumped only when the payload's shape changes, never for a new field. */
const BANNER_FORMAT = 1;

/** The bundle's self-description, as its first line: `//!b44:<format> <json>`.
 *  A fixed sentinel so `head -1` finds it and a reader can version the format,
 *  and JSON so it parses in one call. Before this, a compiled module named its
 *  functions only as scattered `registerLazy` literals in minified output.
 *
 *  Nothing volatile belongs in here. A version's identity is the hash of these
 *  bytes, so a timestamp, a build id or anything else that moves on its own
 *  would re-mint a version for code that did not change; the app id would make
 *  the same functions compile differently per app; the shard's position would
 *  make two identical shards differ. Names are sorted for the same reason — the
 *  module below is assembled in caller order, this line is not. */
function buildBanner(
  entries: AppFunctionEntry[],
  telemetry: boolean,
  runtimeSecrets: boolean,
): string {
  return `//!b44:${BANNER_FORMAT} ${JSON.stringify({
    functions: entries.map(({ fn }) => fn.name).sort(),
    telemetry,
    runtimeSecrets,
    compiler: COMPILER_VERSION,
  })}`;
}

export interface AppFunctionEntry {
  index: number;
  fn: AppFunctionInput;
}

/** Assemble the whole app into ONE bundle-ready Worker: every function's files
 *  namespaced under `fn_<index>/`, one shared shim, and a router that routes by
 *  function name. A single compile resolves and DEDUPES npm deps across all
 *  functions (vs one inlined copy per chunk) — but esbuild fails the whole build
 *  on any unresolved import, so the caller excludes the offending functions
 *  (identified by their `fn_<index>/` path) and rebuilds the survivors. Each
 *  function is sealed to its own `fn_<index>/` keyspace, so one can't import
 *  another's files. */
export function prepareApp(
  entries: AppFunctionEntry[],
  postResponseTelemetry = false,
  runtimeSecrets = false,
): PreparedWorker {
  const files: Record<string, string> = {
    ...workerRuntimeFiles(),
    ...(runtimeSecrets
      ? { [ACTIVATION_FILENAME]: activationShimSource() }
      : {}),
  };
  const moduleFiles = entries.map(({ index, fn }) => {
    assertNoReservedFilenames(fn.files);
    const dir = `fn_${index}`;
    for (const [filePath, content] of Object.entries(userFiles(fn.files))) {
      files[`${dir}/${filePath}`] = content;
    }
    const wrapper = `__base44_fn_${index}.mjs`;
    files[wrapper] = buildFunctionModuleSource(fn.name, `${dir}/${fn.entry}`);
    return wrapper;
  });
  files[ENTRY_FILENAME] = buildAppEntrySource(
    moduleFiles,
    postResponseTelemetry,
    runtimeSecrets,
  );
  return {
    entry: ENTRY_FILENAME,
    files,
    banner: buildBanner(entries, postResponseTelemetry, runtimeSecrets),
  };
}

// Activation prelude for runtime-secrets bundles: gate on the encrypted
// handshake BEFORE any user module is imported (so a needs-activation response
// implies no user side effect ran), then strip the envelope from the request.
const ACTIVATION_GATE = `      const _b44Activation = await ensureActivation(request, env);
      if (_b44Activation) return _b44Activation;
      request = withoutRuntimeSecretsHeader(request);
`;

function activationImport(runtimeSecrets: boolean): string {
  return runtimeSecrets
    ? `\nimport { ensureActivation, withoutActivationSignal, withoutRuntimeSecretsHeader } from "./${ACTIVATION_FILENAME}";`
    : "";
}

/** Build the wrapper entry that loads the shim, lazily imports the user module
 *  on the first request (so init logs are tagged with the real request env),
 *  then exports a standard Worker fetch that delegates to that handler. */
function buildEntrySource(
  userEntry: string,
  telemetry: boolean,
  runtimeSecrets = false,
): string {
  const userImport = `./${userEntry.replace(/^\.\//, "")}`;
  // Handler responses get the activation-signal header stripped (user code must
  // not be able to forge a signal after side effects and cause a re-execution).
  const handlerExpr = telemetry
    ? "_b44AttachTelemetry(await handler(request, info))"
    : runtimeSecrets
      ? "await handler(request, info)"
      : "handler(request, info)";
  const returnExpr = runtimeSecrets
    ? `withoutActivationSignal(${handlerExpr})`
    : handlerExpr;
  return `// Auto-generated by the base44 bundler. Do not edit.

import { currentWorkerRuntimeContext as _b44Context, runWithWorkerEnvironment as _b44Run } from ${JSON.stringify(RUNTIME_CONTEXT_SPECIFIER)};
import { getRegisteredHandler, installStaticEgressFetch } from "./${SHIM_FILENAME}";${activationImport(runtimeSecrets)}

${CONSOLE_PATCH}
// Static egress reads workerEnv from the active request store. Install it
// before telemetry so telemetry remains the outermost fetch wrapper.
installStaticEgressFetch();
${telemetry ? TELEMETRY_PATCH : ""}

let _b44Init = null;
export default {
  async fetch(request, env, ctx) {
    const _b44Env = (request.headers.get('base44-functions-version') ?? '') === 'prod' ? 'prod' : 'preview';
    return _b44Run({ env: _b44Env, secrets: ${runtimeSecrets ? "process.env" : "env"}, workerEnv: env, waitUntil: (p) => ctx.waitUntil(p)${telemetry ? `, ${TELEMETRY_STORE_FIELDS}` : ""} }, async () => {
${runtimeSecrets ? ACTIVATION_GATE : ""}      if (!_b44Init) _b44Init = import(${JSON.stringify(userImport)}).catch(e => { _b44Init = null; throw e; });
      const _b44Mod = await _b44Init;
      // Deno.serve capture wins (legacy contract, zero behavior change);
      // a default-exported handler is the new-contract fallback.
      const handler = getRegisteredHandler() ?? (typeof _b44Mod?.default === 'function' ? _b44Mod.default : null);
      if (!handler) {
        return new Response(
          "The function must export default a request handler or call Deno.serve()",
          { status: 503 },
        );
      }
      // Deno's handler signature is (request, info). Cloudflare doesn't expose a
      // connection address the same way; pass a best-effort placeholder. Real
      // client IP is available via the "cf-connecting-ip" request header.
      const info = {
        remoteAddr: { transport: "tcp", hostname: "0.0.0.0", port: 0 },
      };
      return ${returnExpr};
    });
  },
};
`;
}

function buildFunctionModuleSource(
  functionName: string,
  userEntry: string,
): string {
  const userImport = `./${userEntry.replace(/^\.\//, "")}`;
  return `// Auto-generated by the base44 bundler. Do not edit.
import { registerLazy } from "./${SHIM_FILENAME}";

registerLazy(${JSON.stringify(functionName)}, () => import(${JSON.stringify(userImport)}));
`;
}

function buildAppEntrySource(
  functionModules: string[],
  telemetry: boolean,
  runtimeSecrets = false,
): string {
  const moduleImports = functionModules
    .map((file) => `import "./${file}";`)
    .join("\n");
  const handlerExpr = telemetry
    ? "_b44AttachTelemetry(await handler(request, info))"
    : "await handler(request, info)";
  const returnExpr = runtimeSecrets
    ? `withoutActivationSignal(${handlerExpr})`
    : handlerExpr;
  return `// Auto-generated by the base44 bundler. Do not edit.

import { currentWorkerRuntimeContext as _b44Context, runWithWorkerEnvironment as _b44Run } from ${JSON.stringify(RUNTIME_CONTEXT_SPECIFIER)};
import { installStaticEgressFetch, resolveHandler } from "./${SHIM_FILENAME}";${activationImport(runtimeSecrets)}
${moduleImports}

${CONSOLE_PATCH}
// Static egress reads workerEnv from the active request store. Install it
// before telemetry so telemetry remains the outermost fetch wrapper.
installStaticEgressFetch();
${telemetry ? TELEMETRY_PATCH : ""}

export default {
  async fetch(request, env, ctx) {
    const _b44Env = (request.headers.get('base44-functions-version') ?? '') === 'prod' ? 'prod' : 'preview';
    const functionName = request.headers.get("Base44-Function-Name");
    return _b44Run({ env: _b44Env, fn: functionName ?? '', secrets: ${runtimeSecrets ? "process.env" : "env"}, workerEnv: env, waitUntil: (p) => ctx.waitUntil(p)${telemetry ? `, ${TELEMETRY_STORE_FIELDS}` : ""} }, async () => {
${runtimeSecrets ? ACTIVATION_GATE : ""}      // Each early return below logs through the patch first: per-function log
      // queries on per-app scripts keep only stamped lines, so a bare return
      // would leave the failing invocation with no trace in its own logs.
      const pendingHandler = functionName ? resolveHandler(functionName) : undefined;
      if (pendingHandler === undefined) {
        const message = \`No function registered for "\${functionName ?? ""}"\`;
        console.error(message);
        return new Response(message, { status: 404 });
      }
      let handler;
      try {
        handler = await pendingHandler;
      } catch (e) {
        console.error(\`Function "\${functionName}" failed to initialize:\`, e);
        return new Response(
          \`Function "\${functionName}" failed to initialize: \${e instanceof Error ? e.message : String(e)}\`,
          { status: 500 },
        );
      }
      if (handler === null) {
        const message = \`Function "\${functionName}" must export default a request handler or call Deno.serve()\`;
        console.error(message);
        return new Response(message, { status: 503 });
      }
      // Real client IP is in the "cf-connecting-ip" header, not this placeholder.
      const info = {
        remoteAddr: { transport: "tcp", hostname: "0.0.0.0", port: 0 },
      };
      // Cloudflare reports uncaught exceptions as its own log events, outside
      // the console patch and therefore without function attribution. Log the
      // crash through the patch (stamped with _b44_function) before
      // rethrowing; per-function log queries on per-app scripts keep only
      // stamped lines (see log_query.event_matches_function). Known gap:
      // exceptions thrown while a response body streams happen after this
      // frame returns and cannot be stamped — those crash events are
      // dropped from per-function views.
      try {
        return ${returnExpr};
      } catch (e) {
        console.error(e);
        throw e;
      }
    });
  },
};
`;
}

export function assertNoReservedFilenames(files: Record<string, string>): void {
  // Shim/entry/actor are reserved as exact root keys (unchanged — a flag-off
  // bundle accepts exactly what prod accepts today).
  if (
    SHIM_FILENAME in files ||
    ENTRY_FILENAME in files ||
    ACTOR_ENTRY_FILENAME in files
  ) {
    throw new DenoCompatError(
      `Reserved filenames "${SHIM_FILENAME}" / "${ENTRY_FILENAME}" / "${ACTOR_ENTRY_FILENAME}" must not be present in the function files.`,
    );
  }
  // The activation shim is the ONLY importer allowed to reach the private
  // PDS-manifest store (plaintext VPC/DB creds), and that gate keys on the
  // ACTIVATION_FILENAME basename. Reserve that basename at ANY depth in EVERY
  // mode — not just runtime-secrets. In flag-off / actor bundles no shim is
  // injected, but a user file named `__base44_activation.mjs` would still match
  // the store gate's allow-list and could forge the manifest to retarget a VPC
  // binding; reserving it unconditionally (like shim/entry above) closes that.
  for (const filePath of Object.keys(files)) {
    if (filePath.slice(filePath.lastIndexOf("/") + 1) === ACTIVATION_FILENAME) {
      throw new DenoCompatError(
        `Reserved filename "${ACTIVATION_FILENAME}" must not be present in the function files (found "${filePath}").`,
      );
    }
  }
}

/** Pass user sources through verbatim, dropping any build-config files: we own
 *  the `deno.json` (written into the bundle temp dir) and never honor a
 *  user-supplied one, so it can't change dependency resolution. */
function userFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(files)) {
    if (isBuildConfig(filePath)) continue;
    out[filePath] = content;
  }
  return out;
}

function isBuildConfig(filePath: string): boolean {
  return (
    filePath === "package.json" ||
    filePath.endsWith("/package.json") ||
    filePath === "deno.json" ||
    filePath.endsWith("/deno.json")
  );
}
