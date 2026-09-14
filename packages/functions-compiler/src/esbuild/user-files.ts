/**
 * Serves the prepared worker tree (user sources + injected shim + generated
 * entry) from memory instead of disk. User code is never written to the shared
 * temp filesystem, so a malicious import can't traverse to another build's
 * source — and this plugin is the one place that decides what user code may
 * import: relative paths must stay inside the in-memory keyspace; `npm:`/`jsr:`/
 * `http(s):`/bare specifiers are handed to the Deno resolver; absolute and
 * `file:` imports are refused (the FS-read vector the on-disk layout allowed).
 *
 * Registered BEFORE the Deno resolver so it claims user files first and defers
 * everything else by returning null.
 */

import path from "node:path";
import type { Loader, Plugin } from "esbuild";

export const USER_NAMESPACE = "user";

/** Resolve a relative specifier to the user file it names (posix, exact match —
 *  Deno already requires explicit extensions). Returns the file path, or null
 *  when it isn't in the submission (an escape or a typo). */
function resolveUserFile(
  importerPath: string,
  spec: string,
  files: Record<string, string>,
): string | null {
  const dir = importerPath.includes("/")
    ? importerPath.slice(0, importerPath.lastIndexOf("/"))
    : "";
  const filePath = path.posix.normalize(path.posix.join(dir, spec));
  return filePath in files ? filePath : null;
}

function loaderForFile(filePath: string): Loader {
  if (/\.(ts|mts|cts)$/.test(filePath)) return "ts";
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".json")) return "json";
  return "js";
}

export function userFilesPlugin(
  files: Record<string, string>,
  entryPath: string,
): Plugin {
  return {
    name: "user-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point" && entryPath in files) {
          return { path: entryPath, namespace: USER_NAMESPACE };
        }
        return null;
      });

      build.onResolve({ filter: /.*/, namespace: USER_NAMESPACE }, (args) => {
        if (args.path.startsWith("./") || args.path.startsWith("../")) {
          const filePath = resolveUserFile(args.importer, args.path, files);
          if (filePath) {
            return { path: filePath, namespace: USER_NAMESPACE };
          }

          return forbidden(
            args.path,
            'it must reference a file bundled with this function — check the path and include the extension (e.g. "./util.ts"). Relative imports can\'t reach outside the function; import dependencies with an npm: or jsr: specifier.',
          );
        }
        // Absolute paths and file: URLs would read the bundler's filesystem.
        if (args.path.startsWith("/") || args.path.startsWith("file:")) {
          return forbidden(
            args.path,
            'absolute paths and file: URLs can\'t be imported. Use a relative path (e.g. "./util.ts") for your own files, or an npm:/jsr:/https: specifier for dependencies.',
          );
        }
        return null; // npm:/jsr:/http(s):/node:/bare → Deno resolver
      });

      build.onLoad({ filter: /.*/, namespace: USER_NAMESPACE }, (args) => {
        const contents = files[args.path];
        if (contents === undefined) {
          return null;
        }

        return { contents, loader: loaderForFile(args.path) };
      });
    },
  };
}

function forbidden(spec: string, reason: string) {
  return { errors: [{ text: `Cannot import "${spec}": ${reason}` }] };
}
