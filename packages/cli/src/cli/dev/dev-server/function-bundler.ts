import { mkdirSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Loader as DenoLoader, MediaType } from "@deno/loader";
import type * as esbuildTypes from "esbuild";

// esbuild and @deno/loader are runtime `dependencies`, external to the CLI
// bundle, and deliberately imported dynamically: a static ESM import of an
// external is hoisted to the top of the bundled output, which would load
// these heavyweight packages on every CLI invocation and crash the compiled
// standalone binary (which cannot resolve them) at launch instead of letting
// dev fall back to the Deno runtime. Types are imported statically above —
// they are erased at compile time.
type EsbuildModule = typeof import("esbuild");
type DenoLoaderModule = typeof import("@deno/loader");

let depsPromise:
  | Promise<{ esbuild: EsbuildModule; loaderModule: DenoLoaderModule }>
  | undefined;

function loadDeps() {
  depsPromise ??= (async () => {
    const [esbuild, loaderModule] = await Promise.all([
      import("esbuild"),
      import("@deno/loader"),
    ]);
    return { esbuild, loaderModule };
  })();
  return depsPromise;
}

/**
 * Bundles a backend function into a single workerd-ready ESM module, the way
 * the deployed pipeline does: specifiers (`npm:`, `jsr:`, `https:`, relative
 * files) resolve through `@deno/loader` — Deno's own resolver, so versions,
 * multi-version graphs and `exports` maps behave exactly as they do under
 * Deno — and esbuild flattens the graph. `base44:runtime` is served as a
 * virtual module, mirroring the deployed bundler's virtual-module treatment.
 *
 * This module (and its heavy dependencies) must only be imported through the
 * dynamic boundary in `runtime.js` — see the comment there.
 */

/** The virtual platform module. Exact-match only, same as deployed. */
const RUNTIME_SPECIFIER = "base44:runtime";

/**
 * Same delegator as `backend-runtime/base44-runtime.ts`, inlined so the
 * bundle is self-contained. The generated entry installs the bridge.
 */
const RUNTIME_MODULE = `
const bridge = () => {
  const installed = globalThis.Base44;
  if (!installed) {
    throw new Error("base44:runtime was imported without a Base44 function host.");
  }
  return installed;
};
export const secrets = { get: (name) => bridge().secrets.get(name) };
export function waitUntil(promise) {
  bridge().waitUntil(promise);
  return promise;
}
`;

/** Everything resolved via the Deno loader lives in this esbuild namespace. */
const LOADER_NAMESPACE = "b44-deno";
const VIRTUAL_NAMESPACE = "b44-virtual";
const REEXPORT_NAMESPACE = "b44-node-builtin-reexport";

/** URL schemes workerd provides natively — left external in the bundle. */
const EXTERNAL_SCHEMES = ["node:", "cloudflare:"];

/**
 * The generated Worker entry. It mirrors the deployed entry's contract:
 *
 * - Installs the `globalThis.Base44` bridge (secrets from the request's env
 *   binding, `waitUntil` riding `ctx.waitUntil`) before user code runs.
 * - Installs a minimal `globalThis.Deno` whose `serve` captures the handler
 *   instead of listening and whose `env` reads the same env binding, so
 *   legacy functions keep working.
 * - Imports the user's module lazily inside the first request's store, so
 *   module-scope secret reads see a live env — same as deployed.
 * - `Deno.serve` capture wins over a default export, matching the deployed
 *   bundler's precedence (and the local Deno wrapper's).
 */
const workerEntry = (entryUrl: string): string => `
import { AsyncLocalStorage } from "node:async_hooks";

const _store = new AsyncLocalStorage();
let _servedHandler = null;

globalThis.Base44 = {
  waitUntil(promise) {
    const ctx = _store.getStore()?.ctx;
    if (ctx) ctx.waitUntil(promise);
    else Promise.resolve(promise).catch(() => {});
  },
  secrets: {
    get(name) {
      const value = _store.getStore()?.env?.[String(name)];
      return typeof value === "string" ? value : undefined;
    },
  },
};

// Minimal Deno surface: the documented function APIs (serve, env). The
// deployed runtime injects the full @deno/shim-deno; anything beyond this
// surface should be reported rather than silently diverging.
const _envOverlay = new Map();
globalThis.Deno = {
  env: {
    get: (n) => (_envOverlay.has(n) ? _envOverlay.get(n) : globalThis.Base44.secrets.get(n)),
    set: (n, v) => { _envOverlay.set(String(n), String(v)); },
    has: (n) => _envOverlay.has(n) || globalThis.Base44.secrets.get(n) !== undefined,
    delete: (n) => { _envOverlay.delete(n); },
    toObject: () => {
      const out = {};
      for (const [k, v] of Object.entries(_store.getStore()?.env ?? {})) {
        if (typeof v === "string") out[k] = v;
      }
      for (const [k, v] of _envOverlay) out[k] = v;
      return out;
    },
  },
  serve(arg1, arg2) {
    const handler =
      typeof arg1 === "function" ? arg1
      : typeof arg2 === "function" ? arg2
      : arg1 && typeof arg1.handler === "function" ? arg1.handler
      : null;
    if (!handler) {
      throw new TypeError("Deno.serve: a request handler function is required");
    }
    _servedHandler = handler;
    return {
      finished: Promise.resolve(),
      shutdown: async () => {},
      ref() {},
      unref() {},
      addr: { transport: "tcp", hostname: "0.0.0.0", port: 0 },
    };
  },
};

const _resolveDefault = (mod) => {
  const exported = mod?.default;
  if (typeof exported === "function") return exported;
  if (exported && typeof exported === "object" && typeof exported.fetch === "function") {
    return exported.fetch.bind(exported);
  }
  return null;
};

let _init;
export default {
  async fetch(request, env, ctx) {
    return _store.run({ env, ctx }, async () => {
      // First request imports the user module inside the request store, so
      // module-scope code (init logs, secrets reads) sees a live env.
      _init ??= import(${JSON.stringify(entryUrl)});
      const mod = await _init;
      const handler = _servedHandler ?? _resolveDefault(mod);
      if (!handler) {
        return new Response(
          "The function must export default a request handler or call Deno.serve()",
          { status: 500 },
        );
      }
      return await handler(request);
    });
  },
};
`;

/**
 * Under Node the loader needs a deno.json with \`nodeModulesDir: "auto"\` to
 * auto-fetch npm dependencies (it does its own fetch + DENO_DIR caching and
 * never runs lifecycle scripts). Deliberately NOT the project's own deno.json:
 * project-level Deno config is not applied to functions locally or deployed.
 */
function ensureBundlerConfig(): string {
  const dir = join(homedir(), ".base44", "function-bundler");
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, "deno.json");
  writeFileSync(
    configPath,
    `${JSON.stringify({ nodeModulesDir: "auto" }, null, 2)}\n`,
  );
  return configPath;
}

let loaderPromise: Promise<DenoLoader> | undefined;

function getLoader(loaderModule: DenoLoaderModule): Promise<DenoLoader> {
  loaderPromise ??= new loaderModule.Workspace({
    configPath: ensureBundlerConfig(),
    noLock: true,
    platform: "browser",
    nodeConditions: ["workerd", "worker", "browser"],
  }).createLoader();
  return loaderPromise;
}

const esbuildLoaderFor = (
  mediaType: MediaType,
  { MediaType: MediaTypes }: DenoLoaderModule,
): esbuildTypes.Loader => {
  switch (mediaType) {
    case MediaTypes.Json:
      return "json";
    case MediaTypes.Css:
      return "css";
    default:
      // TypeScript/JSX arrive already transpiled by the loader.
      return "js";
  }
};

function denoLoaderPlugin(
  loader: DenoLoader,
  loaderModule: DenoLoaderModule,
): esbuildTypes.Plugin {
  return {
    name: "b44-deno-loader",
    setup(build) {
      const resolveSpecifier = async (
        args: esbuildTypes.OnResolveArgs,
      ): Promise<esbuildTypes.OnResolveResult> => {
        // esbuild lowers a CJS `require()` of an external builtin to a
        // `__require()` that throws on workerd; rewrite those to a module
        // that statically imports the builtin and re-exports it. Same
        // treatment as the deployed bundler. `isBuiltin` on the full
        // specifier rejects lookalikes like `require("string_decoder/")`.
        if (args.kind === "require-call" && isBuiltin(args.path)) {
          return { path: args.path, namespace: REEXPORT_NAMESPACE };
        }
        if (args.path === RUNTIME_SPECIFIER) {
          return { path: args.path, namespace: VIRTUAL_NAMESPACE };
        }
        if (args.path.startsWith(`${RUNTIME_SPECIFIER}/`)) {
          return {
            errors: [
              {
                text: `Subpath imports of "${RUNTIME_SPECIFIER}" are not supported — import { secrets, waitUntil } from "${RUNTIME_SPECIFIER}".`,
              },
            ],
          };
        }
        for (const scheme of EXTERNAL_SCHEMES) {
          if (args.path.startsWith(scheme)) {
            return { path: args.path, external: true };
          }
        }

        // Only loader-resolved modules carry a URL importer.
        const referrer =
          args.namespace === LOADER_NAMESPACE ? args.importer : undefined;
        try {
          const resolved = await loader.resolve(
            args.path,
            referrer,
            loaderModule.ResolutionMode.Import,
          );
          for (const scheme of EXTERNAL_SCHEMES) {
            if (resolved.startsWith(scheme)) {
              return { path: resolved, external: true };
            }
          }
          return { path: resolved, namespace: LOADER_NAMESPACE };
        } catch (error) {
          // Deployed behaviour: uninstalled *optional* deps stay external so
          // packages like axios bundle; the author's guard handles the miss.
          if (
            error instanceof loaderModule.ResolveError &&
            error.isOptionalDependency
          ) {
            return { path: args.path, external: true };
          }
          throw error;
        }
      };

      // Imports from the generated entry (default namespace)…
      build.onResolve({ filter: /.*/ }, resolveSpecifier);
      // …and from every module the loader served.
      build.onResolve(
        { filter: /.*/, namespace: LOADER_NAMESPACE },
        resolveSpecifier,
      );

      build.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, () => ({
        contents: RUNTIME_MODULE,
        loader: "js",
      }));

      // Default export so `require("stream")` is the Stream class, not the
      // namespace object.
      build.onLoad({ filter: /.*/, namespace: REEXPORT_NAMESPACE }, (args) => ({
        contents: `import * as builtin from "${args.path}";\nmodule.exports = builtin.default ?? builtin;\n`,
        loader: "js",
      }));

      build.onLoad(
        { filter: /.*/, namespace: LOADER_NAMESPACE },
        async (args) => {
          const response = await loader.load(
            args.path,
            loaderModule.RequestedModuleType.Default,
          );
          if (response.kind !== "module") {
            return { external: true } as esbuildTypes.OnLoadResult;
          }
          return {
            contents: Buffer.from(response.code),
            loader: esbuildLoaderFor(response.mediaType, loaderModule),
          };
        },
      );
    },
  };
}

interface BundledFunction {
  /** Single ESM module targeting workerd. */
  code: string;
}

export class FunctionBundleError extends Error {}

/**
 * Release everything that would otherwise keep the Node event loop alive
 * after the dev server shuts down — most importantly esbuild's long-lived
 * service child process. The CLI never calls process.exit, so shutdown
 * depends on the loop draining. esbuild transparently restarts its service
 * on the next build, so this is safe to call between reloads too.
 */
export async function disposeBundler(): Promise<void> {
  if (!depsPromise) {
    return;
  }
  const { esbuild } = await depsPromise;
  await esbuild.stop();
  loaderPromise = undefined;
}

/** Bundle one backend function's entry file into a workerd ESM module. */
export async function bundleFunction(
  entryPath: string,
): Promise<BundledFunction> {
  const { esbuild, loaderModule } = await loadDeps();
  const loader = await getLoader(loaderModule);
  const entryUrl = pathToFileURL(entryPath).href;

  // Registering the entrypoint up front lets the loader build the npm/jsr
  // graph the way Deno would, instead of ad-hoc per-specifier installs.
  const diagnostics = await loader.addEntrypoints([entryUrl]);
  if (diagnostics.length > 0) {
    throw new FunctionBundleError(diagnostics.map((d) => d.message).join("\n"));
  }

  try {
    const result = await esbuild.build({
      stdin: {
        contents: workerEntry(entryUrl),
        sourcefile: "b44-worker-entry.mjs",
        loader: "js",
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      conditions: ["workerd", "worker", "browser", "module"],
      // workerd ESM lacks __dirname/__filename; define rewrites only free
      // references (npm glue), leaving loader-bound CJS locals intact.
      define: { __dirname: '"/"', __filename: '"/index.js"' },
      logLevel: "silent",
      plugins: [denoLoaderPlugin(loader, loaderModule)],
    });
    return { code: result.outputFiles[0].text };
  } catch (error) {
    const messages = (error as { errors?: esbuildTypes.Message[] }).errors;
    if (messages?.length) {
      const text = messages
        .map((m) => {
          const loc = m.location
            ? `${m.location.file}:${m.location.line}:${m.location.column}: `
            : "";
          return `${loc}${m.text}`;
        })
        .join("\n");
      throw new FunctionBundleError(text);
    }
    throw error;
  }
}
