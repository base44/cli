import { dirname, relative, resolve } from "node:path";
import {
  type BundleResponse,
  bundle,
  collectReachableFiles,
  STATIC_EGRESS_ARTIFACT_MARKER,
} from "@base44/functions-compiler";
import { globby } from "globby";
import pMap from "p-map";
import { BACKEND_FILE_GLOB } from "@/core/consts.js";
import { InternalError, InvalidInputError } from "@/core/errors.js";
import { readAllActors } from "@/core/resources/actor/config.js";
import type { ActorDefinition } from "@/core/resources/actor/schema.js";
import { pathExists, readTextFile } from "@/core/utils/fs.js";
import {
  describeFailure,
  requireCompilerRuntime,
  sha256,
} from "@/core/version/functions.js";
import type { ActorArtifact } from "@/core/version/schema.js";

/** Must match the server's ceiling: declaring more only earns a late rejection. */
const MAX_ACTORS = 50;

/** Each actor is an esbuild run of its own; the compiler bounds its own
 * per-function fan-out at the same 4. */
const COMPILE_CONCURRENCY = 4;

/**
 * Where the compiler expects an actor and the modules it shares, wherever the
 * project keeps them: an entry at `base44/actors/<Name>/entry.ts` is what makes
 * it an actor named `<Name>`. `../../shared/x.ts` from the entry still lands on
 * `base44/shared/x.ts`, because the shared directory sits beside the actors
 * directory just as it does beside the functions one.
 */
const ACTORS_ROOT = "base44/actors";
const SHARED_ROOT = "base44/shared";

function forwardSlashed(from: string, to: string): string {
  return relative(from, to).split(/[/\\]/).join("/");
}

/** Every file under the shared directory, keyed where the compiler looks. */
async function readSharedFiles(
  actorsDir: string,
): Promise<Record<string, string>> {
  const sharedDir = resolve(actorsDir, "..", "shared");
  if (!(await pathExists(sharedDir))) {
    return {};
  }
  const paths = await globby(BACKEND_FILE_GLOB, {
    cwd: sharedDir,
    absolute: true,
  });
  const files: Record<string, string> = {};
  for (const path of paths.sort()) {
    files[`${SHARED_ROOT}/${forwardSlashed(sharedDir, path)}`] =
      await readTextFile(path);
  }
  return files;
}

/**
 * What one actor compiles from, as apper submits it: the files its entry
 * reaches among its own folder and the shared modules, and nothing else — a
 * reach into another actor or a function stays unresolved, and fails the
 * compile. An `entry.js` is keyed `entry.ts` too, as apper re-homes one.
 *
 * Not `cfwBundleInput`: it flattens an entry that reaches nothing to `main.ts`,
 * which is the path that says "actor".
 */
async function compilerInput(
  actor: ActorDefinition,
  shared: Record<string, string>,
): Promise<{ entry: string; files: Record<string, string>; source: string }> {
  const actorDir = dirname(actor.entryPath);
  const entry = `${ACTORS_ROOT}/${actor.name}/entry.ts`;
  const source = await readTextFile(actor.entryPath);
  const candidates: Record<string, string> = { ...shared };
  for (const filePath of actor.filePaths) {
    if (filePath !== actor.entryPath) {
      candidates[
        `${ACTORS_ROOT}/${actor.name}/${forwardSlashed(actorDir, filePath)}`
      ] = await readTextFile(filePath);
    }
  }
  candidates[entry] = source;
  return {
    entry,
    files: await collectReachableFiles(entry, candidates),
    source,
  };
}

/**
 * Every actor, each compiled into a module of its own. One that fails to compile
 * fails the whole set: a version without it would describe the app without it.
 */
export async function compileActors(
  actorsDir: string,
): Promise<ActorArtifact[]> {
  const actors = await readAllActors(actorsDir);
  if (actors.length === 0) {
    return [];
  }
  if (actors.length > MAX_ACTORS) {
    throw new InvalidInputError(
      `Too many actors: found ${actors.length}, the limit is ${MAX_ACTORS}.`,
    );
  }

  await requireCompilerRuntime("Actors");
  const shared = await readSharedFiles(actorsDir);
  // By name, so the declared order — and with it every upload slot — does not
  // follow a filesystem walk.
  const sorted = [...actors].sort((a, b) => (a.name < b.name ? -1 : 1));
  const compiled = await pMap(
    sorted,
    async (actor) => {
      const input = await compilerInput(actor, shared);
      const result = await bundle({ entry: input.entry, files: input.files });
      return {
        name: actor.name,
        entry: input.entry,
        source: input.source,
        result,
      };
    },
    { concurrency: COMPILE_CONCURRENCY },
  );

  const failures = compiled.flatMap(({ name, result }) =>
    result.ok
      ? []
      : [
          {
            function: name,
            message: `Actor "${name}" failed to compile.`,
            errors: result.errors,
          },
        ],
  );
  if (failures.length > 0) {
    throw new InvalidInputError(
      `Actors failed to compile (${failures.length} error${failures.length === 1 ? "" : "s"}).`,
      { details: failures.map(describeFailure) },
    );
  }

  return compiled.map(({ name, entry, source, result }) => {
    const module = new TextEncoder().encode(compiledModule(name, result));
    return {
      name,
      entry,
      source,
      module,
      size: module.byteLength,
      digest: sha256(module),
      // The actor's prelude installs the same static-egress fetch every worker
      // entry does, so its module is compiled for the same contract.
      staticEgress: STATIC_EGRESS_ARTIFACT_MARKER,
    };
  });
}

/** The module, once the compiler has confirmed it built an actor of that name —
 * a plain Worker deployed under an actor's identity would serve no rooms. */
function compiledModule(name: string, result: BundleResponse): string {
  if (!result.ok || result.do_class_name !== name) {
    throw new InternalError(
      `Actor "${name}" did not compile as an actor of that name.`,
    );
  }
  return result.module;
}
