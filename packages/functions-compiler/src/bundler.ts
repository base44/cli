import { type ActorCompat, applyActorCompat } from "./actor-compat.js";
import type { BundleAppRequest, BundleRequest } from "./contracts.js";
import { bundleToModule, type NodeModulesMode } from "./deno-bundle.js";
import { type BundleErrorItem, DenoCompatError } from "./errors.js";
import { setSpanTags, withSpan } from "./tracing.js";
import {
  type AppFunctionEntry,
  type PreparedWorker,
  prepareApp,
  prepareFunction,
} from "./worker-entry.js";

export type { BundleErrorItem };

// `deno_compat` = the function couldn't even be assembled (reserved filenames);
// `esbuild` = resolution/compile/load failure from the Deno resolver or esbuild.
export type BundleErrorStage = "deno_compat" | "esbuild";

// Response for /v1/bundle (single function).
// handler_name / do_class_name are set only when the entry extends Actor.
export type BundleResponse =
  | {
      ok: true;
      module: string;
      main_module: string;
      warnings: string[];
      handler_name?: string;
      do_class_name?: string;
    }
  | {
      ok: false;
      stage: BundleErrorStage;
      errors: BundleErrorItem[];
    };

export type AppFunctionStatus =
  | { name: string; ok: true }
  | { name: string; ok: false; errors: BundleErrorItem[] };

// Response for /v1/bundle-app. `module` carries the assembled Worker (only the
// functions that compiled); `functions` reports per-function status so the
// backend deploys the good ones and attributes the failures.
export type BundleAppResponse =
  | {
      ok: true;
      module: string;
      main_module: string;
      functions: AppFunctionStatus[];
    }
  | {
      ok: false;
      module: null;
      functions: AppFunctionStatus[];
    };

// The single-module output is uploaded to Workers-for-Platforms under this
// name. Keep stable: the Python `BundlerClient`'s caller persists this in
// the script metadata's `main_module`.
const NORMALIZED_MAIN_MODULE = "_bundled.mjs";

// Per-function compiles run concurrently; each materializes its own temp dir
// and esbuild build, so peak memory scales with how many run at once — bound it.
const MAX_PARALLEL_COMPILES = 4;

export async function bundle(req: BundleRequest): Promise<BundleResponse> {
  // Check for Actor before the Deno-shim path.
  let actor: ActorCompat | null;
  try {
    actor = applyActorCompat(req.entry, req.files);
  } catch (e) {
    return denoCompatErrorOrThrow(e);
  }
  if (actor) {
    if (req.runtimeSecrets) {
      // Actors are binding-mode by design: their code runs in a Durable Object
      // that reads secrets from the DO env, and actor connect dials the
      // dispatcher without a handshake — an activation wrapper would leave them
      // with no secrets at all. The backend already forces binding mode for
      // actors, so this combination is a caller bug. Fail loud instead of
      // returning a bundle that silently ignored the flag.
      return denoCompatErrorOrThrow(
        new DenoCompatError(
          "runtimeSecrets is not supported for Actor entries: an Actor reads secrets " +
            "from its Durable Object env, so it must be deployed in binding mode.",
        ),
      );
    }
    const outcome = await installAndCompile({
      entry: actor.entry,
      files: actor.files,
    });
    if (outcome.ok) {
      return {
        ok: true,
        module: outcome.module,
        main_module: NORMALIZED_MAIN_MODULE,
        warnings: outcome.warnings,
        handler_name: actor.handlerName,
        do_class_name: actor.doClassName,
      };
    }
    return { ok: false, stage: outcome.stage, errors: outcome.errors };
  }

  let prepared: PreparedWorker;
  try {
    prepared = await prepareFunction(
      req.entry,
      req.files,
      req.postResponseTelemetry,
      req.runtimeSecrets,
    );
  } catch (e) {
    return denoCompatErrorOrThrow(e);
  }
  const outcome = await installAndCompile(prepared);
  if (outcome.ok) {
    return {
      ok: true,
      module: outcome.module,
      main_module: NORMALIZED_MAIN_MODULE,
      warnings: outcome.warnings,
    };
  }
  return { ok: false, stage: outcome.stage, errors: outcome.errors };
}

// One combined build resolves npm deps once and dedupes them across functions.
// esbuild fails the whole build on any unresolved import, so on failure we map
// each error to the function it came from, drop those, and rebuild the rest.
export async function bundleApp(
  req: BundleAppRequest,
): Promise<BundleAppResponse> {
  const telemetry = req.postResponseTelemetry ?? false;
  const runtimeSecrets = req.runtimeSecrets ?? false;
  const entries: AppFunctionEntry[] = req.functions.map((fn, index) => ({
    index,
    fn,
  }));

  let combined: CombinedOutcome;
  try {
    combined = await compileApp(entries, telemetry, runtimeSecrets);
  } catch (e) {
    if (e instanceof DenoCompatError)
      return bundleAppPerFunction(entries, telemetry, runtimeSecrets);
    throw e;
  }
  if (combined.ok) {
    return appResponse(combined.module, allOk(entries));
  }

  const { byIndex, unattributable } = classifyAppErrors(combined.errors);
  // An error we can't pin to one function (deep in a shared dep, or no location)
  // means the combined build can't tell us what to drop — isolate per function.
  if (unattributable.length > 0) {
    return bundleAppPerFunction(entries, telemetry, runtimeSecrets);
  }

  const functions: AppFunctionStatus[] = entries.map((e) =>
    byIndex.has(e.index)
      ? { name: e.fn.name, ok: false, errors: byIndex.get(e.index)! }
      : { name: e.fn.name, ok: true },
  );
  const survivors = entries.filter((e) => !byIndex.has(e.index));
  if (survivors.length === 0) {
    return { ok: false, module: null, functions };
  }

  let rebuilt: CombinedOutcome;
  try {
    rebuilt = await compileApp(survivors, telemetry, runtimeSecrets);
  } catch (e) {
    if (e instanceof DenoCompatError)
      return bundleAppPerFunction(entries, telemetry, runtimeSecrets);
    throw e;
  }
  if (rebuilt.ok) return appResponse(rebuilt.module, functions);
  // Survivors still don't build — fall back rather than fail the whole app.
  return bundleAppPerFunction(entries, telemetry, runtimeSecrets);
}

type CombinedOutcome =
  | { ok: true; module: string }
  | { ok: false; errors: BundleErrorItem[] };

async function compileApp(
  entries: AppFunctionEntry[],
  telemetry = false,
  runtimeSecrets = false,
): Promise<CombinedOutcome> {
  const outcome = await installAndCompile(
    prepareApp(entries, telemetry, runtimeSecrets),
  );
  return outcome.ok
    ? { ok: true, module: outcome.module }
    : { ok: false, errors: outcome.errors };
}

function allOk(entries: AppFunctionEntry[]): AppFunctionStatus[] {
  return entries.map((e) => ({ name: e.fn.name, ok: true }));
}

function appResponse(
  module: string,
  functions: AppFunctionStatus[],
): BundleAppResponse {
  return { ok: true, module, main_module: NORMALIZED_MAIN_MODULE, functions };
}

export interface AppErrorClassification {
  byIndex: Map<number, BundleErrorItem[]>;
  unattributable: BundleErrorItem[];
}

/** Map each combined-build error to the function whose `fn_<index>/` subtree it
 *  came from, stripping that prefix so the user sees their own path. Errors with
 *  no `fn_<index>/` prefix (a shared dep deep in node_modules, or no location)
 *  can't be pinned to one function. */
export function classifyAppErrors(
  errors: BundleErrorItem[],
): AppErrorClassification {
  const byIndex = new Map<number, BundleErrorItem[]>();
  const unattributable: BundleErrorItem[] = [];
  for (const err of errors) {
    const match = err.file?.match(/^fn_(\d+)\/(.*)$/);
    if (!match) {
      unattributable.push(err);
      continue;
    }
    const index = Number(match[1]);
    const list = byIndex.get(index) ?? [];
    list.push({ ...err, file: match[2] });
    byIndex.set(index, list);
  }
  return { byIndex, unattributable };
}

/** Fallback for the rare error the combined build can't attribute to one
 *  function: compile each function alone — where every error is unambiguously
 *  its own — to learn which build, then build the survivors together. Reuses
 *  the same combined-build path, so there's no second bundling engine. */
async function bundleAppPerFunction(
  entries: AppFunctionEntry[],
  telemetry = false,
  runtimeSecrets = false,
): Promise<BundleAppResponse> {
  const probes = await mapWithConcurrency(
    entries,
    MAX_PARALLEL_COMPILES,
    (entry) => probeFunction(entry, runtimeSecrets),
  );

  const functions: AppFunctionStatus[] = probes.map((p) =>
    p.ok
      ? { name: p.entry.fn.name, ok: true }
      : { name: p.entry.fn.name, ok: false, errors: p.errors },
  );
  const survivors = probes.filter((p) => p.ok).map((p) => p.entry);
  if (survivors.length === 0) {
    return { ok: false, module: null, functions };
  }

  const combined = await compileApp(survivors, telemetry, runtimeSecrets);
  if (combined.ok) return appResponse(combined.module, functions);
  // Each survivor built alone but not together: the combined graph resolved a
  // shared npm package onto a version some importer can't use. Deterministic
  // user-dep breakage — a 500 here gets retried by the platform and surfaced
  // as an infrastructure error, hiding the diagnostics the agent needs.
  return assembleWithoutConflicting(
    survivors,
    functions,
    combined.errors,
    telemetry,
    runtimeSecrets,
  );
}

/** Assembly failed on errors originating inside shared npm deps. Blame the
 *  functions whose source imports the package (and major) the errors come
 *  from, rebuild the rest, and report the blamed ones with the real
 *  diagnostics. When nothing can be blamed — or the rebuild still fails —
 *  every remaining function reports the diagnostics instead of a crash. */
async function assembleWithoutConflicting(
  survivors: AppFunctionEntry[],
  functions: AppFunctionStatus[],
  errors: BundleErrorItem[],
  telemetry: boolean,
  runtimeSecrets = false,
): Promise<BundleAppResponse> {
  const failWith = (entries: AppFunctionEntry[], items: BundleErrorItem[]) => {
    for (const e of entries) {
      functions[e.index] = { name: e.fn.name, ok: false, errors: items };
    }
  };
  const conflictErrors: BundleErrorItem[] = [
    {
      message:
        "npm dependency version conflict: this function's dependencies resolve " +
        "differently when bundled with the app's other functions. Align the " +
        "conflicting package versions across functions.",
    },
    ...errors,
  ];

  const blamed = survivors.filter((e) => importsConflictingPackage(e, errors));
  const rest = survivors.filter((e) => !blamed.includes(e));
  if (blamed.length > 0 && rest.length > 0) {
    const rebuilt = await compileApp(rest, telemetry, runtimeSecrets);
    if (rebuilt.ok) {
      failWith(blamed, conflictErrors);
      return appResponse(rebuilt.module, functions);
    }
    // Removing the blamed functions exposed a further failure — no module was
    // produced, so every survivor must report it (ok:false means all failed).
    failWith(blamed, conflictErrors);
    failWith(rest, [conflictErrors[0], ...rebuilt.errors]);
    return { ok: false, module: null, functions };
  }
  failWith(blamed.length > 0 ? blamed : survivors, conflictErrors);
  return { ok: false, module: null, functions };
}

// `imported from '…registry.npmjs.org/<pkg>/<version>/…'` — the package whose
// own imports the combined graph broke, i.e. the one to trace back to a function.
const IMPORTED_FROM_PACKAGE =
  /imported from '[^']*registry\.npmjs\.org\/((?:@[^/]+\/)?[^/@]+)\/(\d+)/g;

/** Does this function's source import one of the packages the assembly errors
 *  originate from, at (or possibly at) the failing major? A specifier pinned to
 *  a different major is exonerated — its copy of the package is the one that
 *  works; an unpinned specifier stays blamed. */
export function importsConflictingPackage(
  entry: AppFunctionEntry,
  errors: BundleErrorItem[],
): boolean {
  const culprits = new Map<string, Set<string>>();
  for (const err of errors) {
    for (const m of err.message.matchAll(IMPORTED_FROM_PACKAGE)) {
      (culprits.get(m[1]) ?? culprits.set(m[1], new Set()).get(m[1])!).add(
        m[2],
      );
    }
  }
  const sources = Object.values(entry.fn.files);
  for (const [pkg, majors] of culprits) {
    const spec = new RegExp(
      `['"](?:npm:)?(${escapeRegExp(pkg)})(@[^'"]*)?['"/]`,
    );
    for (const source of sources) {
      const m = source.match(spec);
      if (!m) continue;
      const pinnedMajor = m[2]?.match(/\d+/)?.[0];
      if (!pinnedMajor || majors.has(pinnedMajor)) return true;
    }
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type FunctionProbe =
  | { ok: true; entry: AppFunctionEntry }
  | { ok: false; entry: AppFunctionEntry; errors: BundleErrorItem[] };

/** Compile one function alone. With only its files in the build, every error is
 *  its own — the `fn_<index>/` ones stripped, the rest (deep deps) kept as-is.
 *  Compiles in the real `runtimeSecrets` mode so a mode-dependent failure (a
 *  user file named the reserved activation filename) is attributed to its
 *  function instead of leaking out of the final assembly as a 500. */
async function probeFunction(
  entry: AppFunctionEntry,
  runtimeSecrets = false,
): Promise<FunctionProbe> {
  let outcome: CombinedOutcome;
  try {
    outcome = await compileApp([entry], false, runtimeSecrets);
  } catch (e) {
    if (e instanceof DenoCompatError) {
      return { ok: false, entry, errors: [denoCompatErrorItem(e)] };
    }
    throw e;
  }
  if (outcome.ok) return { ok: true, entry };
  const { byIndex, unattributable } = classifyAppErrors(outcome.errors);
  return {
    ok: false,
    entry,
    errors: [...(byIndex.get(entry.index) ?? []), ...unattributable],
  };
}

/** Map with a bounded number of concurrent workers; results keep input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  };
  const size = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}

type CompileOutcome =
  | { ok: true; module: string; warnings: string[] }
  | { ok: false; stage: BundleErrorStage; errors: BundleErrorItem[] };

// The resolution failures that only happen in "none" mode and that "auto" fixes.
const NODE_MODULES_FALLBACK =
  /ERR_MODULE_NOT_FOUND|Could not find referrer npm package/;

/** Compile the prepared tree to a single module via the Deno resolver engine.
 *  Shared by the single-function path and the combined app build. */
async function installAndCompile(
  prepared: PreparedWorker,
): Promise<CompileOutcome> {
  return withSpan("base44.bundler.compile", async () => {
    // The problem this solves: we resolve npm from the shared cache without a
    // per-build node_modules ("none") because it's fast. But Deno sometimes splits
    // a package into a deduplicated "phantom" copy — e.g. two resend versions both
    // pull react-dom, so it creates react-dom@18.2.0 AND react-dom@18.2.0_1 — and
    // that "_1" copy has no folder on disk, so "none" can't load its files and the
    // whole app fails to bundle. Retry just that failure with "auto", which writes
    // a real node_modules where the phantom copy becomes a real directory.
    let mode: NodeModulesMode = "none";
    let result = await bundleToModule(prepared, mode);
    if (
      !result.ok &&
      result.errors.some((e) => NODE_MODULES_FALLBACK.test(e.message))
    ) {
      mode = "auto";
      result = await bundleToModule(prepared, mode);
    }
    // node_modules_mode:auto marks the fallback firing; with outcome it shows how
    // often the edge case hits and whether "auto" then rescued it.
    await setSpanTags({
      node_modules_mode: mode,
      outcome: result.ok ? "ok" : "failed",
    });
    if (result.ok) {
      return { ok: true, module: result.module, warnings: result.warnings };
    }
    return { ok: false, stage: "esbuild", errors: result.errors };
  });
}

function denoCompatErrorOrThrow(e: unknown): BundleResponse {
  if (e instanceof DenoCompatError) {
    return {
      ok: false,
      stage: "deno_compat",
      errors: [denoCompatErrorItem(e)],
    };
  }
  throw e;
}

function denoCompatErrorItem(e: DenoCompatError): BundleErrorItem {
  return { message: e.message, file: e.file };
}
