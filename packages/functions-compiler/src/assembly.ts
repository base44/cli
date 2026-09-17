/**
 * Turn a backend function into the `{entry, files}` the compiler takes.
 *
 * A function may import a helper beside it or a module shared across functions
 * (`../../shared/x.ts`). The compiler resolves relative imports by exact match
 * inside `files`, so anything the function reaches has to be submitted with it —
 * otherwise the import has no target and the build fails with "can't reach
 * outside the function".
 *
 * Ported from apper's `backend/app/cloudflare_functions/function_bundle.py`.
 * That walks the import graph with a tree-sitter parse, as a stand-in for what
 * the bundler would see; here esbuild does the walk, so it is not a stand-in —
 * the file set is what the compiler itself reaches. Verified against the Python
 * fixtures in assembly.test.ts.
 */

import path from "node:path";
import { build } from "esbuild";

const NAMESPACE = "base44-reachability";

/** The flat shape a single-file function has always been submitted as. Keeping
 *  it means those functions compile to the same bytes they do today. */
const FLAT_ENTRY = "main.ts";

export interface BundleInput {
  entry: string;
  files: Record<string, string>;
}

function loaderFor(filePath: string) {
  if (/\.(ts|mts|cts)$/.test(filePath)) return "ts" as const;
  if (filePath.endsWith(".tsx")) return "tsx" as const;
  if (filePath.endsWith(".jsx")) return "jsx" as const;
  if (filePath.endsWith(".json")) return "json" as const;
  return "js" as const;
}

function resolveRelative(
  importer: string,
  spec: string,
  files: Record<string, string>,
): string | null {
  const dir = importer.includes("/")
    ? importer.slice(0, importer.lastIndexOf("/"))
    : "";
  const resolved = path.posix.normalize(path.posix.join(dir, spec));
  return resolved in files ? resolved : null;
}

/** esbuild's own account of what the entry reaches: the metafile inputs, keyed
 *  by the paths the plugin resolved. Its own function so a failure can be
 *  handled by the caller. */
async function walkInputs(
  entryPath: string,
  backendFiles: Record<string, string>,
): Promise<Record<string, unknown>> {
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    metafile: true,
    logLevel: "silent",
    // Relative to nothing on disk: every path here is a project path served
    // from memory, and nothing resolves to the filesystem.
    absWorkingDir: path.sep,
    // TypeScript drops an import whose bindings go unused, which would hide a
    // file the function really does pull in. Keep every import as written.
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
    plugins: [
      {
        name: "base44-reachability",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") {
              return { path: entryPath, namespace: NAMESPACE };
            }
            if (args.path.startsWith("./") || args.path.startsWith("../")) {
              const target = resolveRelative(
                args.importer,
                args.path,
                backendFiles,
              );
              if (target) return { path: target, namespace: NAMESPACE };
            }
            return { path: args.path, external: true };
          });

          pluginBuild.onLoad(
            { filter: /.*/, namespace: NAMESPACE },
            (args) => ({
              contents: backendFiles[args.path],
              loader: loaderFor(args.path),
            }),
          );
        },
      },
    ],
  });
  return result.metafile.inputs;
}

/**
 * Every backend file reachable from `entryPath` through `./` and `../` imports,
 * including the entry. A specifier with no target in `backendFiles` — a typo, or
 * a frontend file the caller deliberately excluded — is left out, so it stays
 * forbidden by the compiler rather than being resolved here. `npm:`, `jsr:`,
 * `node:` and bare specifiers are not edges into the project and are ignored.
 *
 * A source the walk cannot parse yields the entry alone, so the function
 * compiles as the flat single-file submission and the compiler reports the
 * error itself.
 */
export async function collectReachableFiles(
  entryPath: string,
  backendFiles: Record<string, string>,
): Promise<Record<string, string>> {
  if (!(entryPath in backendFiles)) {
    throw new Error(`entry "${entryPath}" is not among the backend files`);
  }

  let inputs: Record<string, unknown>;
  try {
    inputs = await walkInputs(entryPath, backendFiles);
  } catch {
    // apper's walk cannot fail this way: it reads each file on its own, so a
    // file it cannot parse contributes no edges and the rest of the set still
    // assembles. esbuild's walk is all-or-nothing — one unparseable source
    // anywhere in the graph rejects here. Falling back to the entry alone keeps
    // the flat submission a single-file function has always had, and the compile
    // then fails with the compiler's own diagnostic, which the builder agent can
    // act on. An exception out of assembly has nowhere to be reported at all.
    return { [entryPath]: backendFiles[entryPath] };
  }

  const reached: Record<string, string> = {};
  for (const input of Object.keys(inputs)) {
    const filePath = input.startsWith(`${NAMESPACE}:`)
      ? input.slice(NAMESPACE.length + 1)
      : input;
    if (filePath in backendFiles) reached[filePath] = backendFiles[filePath];
  }
  return reached;
}

/**
 * The `{entry, files}` to compile for one function.
 *
 * A function that reaches nothing beyond its own entry keeps the flat
 * `main.ts` submission, byte-identical to how it compiles today. One that
 * reaches a helper or a shared module gets its real project path as the entry,
 * so `../../shared/x.ts` resolves against the files beside it.
 *
 * `backendFiles` must hold the backend tree only. A frontend path left in it
 * would resolve, and a function would silently bundle frontend code.
 */
export async function cfwBundleInput(
  entryPath: string,
  entryContent: string,
  backendFiles: Record<string, string>,
): Promise<BundleInput> {
  const files = await collectReachableFiles(entryPath, {
    ...backendFiles,
    [entryPath]: entryContent,
  });
  const reachedOnlyTheEntry =
    Object.keys(files).length === 1 && entryPath in files;
  if (reachedOnlyTheEntry) {
    return { entry: FLAT_ENTRY, files: { [FLAT_ENTRY]: entryContent } };
  }
  return { entry: entryPath, files };
}
