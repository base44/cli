/**
 * Rewrites an esbuild source map's `sources` so they name the app's own files.
 *
 * esbuild names an in-memory user file `user:<key>` (per-app bundles nest each
 * function under `user:fn_<index>/<key>`), and everything else by its namespace
 * or by a path relative to the build's temp dir. A source that is one of the
 * request's files becomes that file's path; a function's entry becomes its
 * `entryPath` when the caller sent one. Every other source — the shim, the
 * generated entry and wrappers, the virtual runtime modules, npm and remote
 * modules — stays in the list, since the mappings address sources by index,
 * and is prefixed `base44-internal:` so nothing downstream reads it as an app
 * file.
 */

import { USER_NAMESPACE } from "./esbuild/user-files.js";

export const INTERNAL_SOURCE_PREFIX = "base44-internal:";

/** The request files one function's sources are checked against. */
export interface SourceMapFunction {
  entry: string;
  files: Record<string, string>;
  entryPath?: string;
}

const USER_PREFIX = `${USER_NAMESPACE}:`;
const APP_FUNCTION_PATH = /^fn_(\d+)\/(.*)$/;

/** Rewrite a single-function bundle's map. */
export function functionSourceMap(raw: string, fn: SourceMapFunction): string {
  return rewriteSources(raw, (key) => appPath(fn, key));
}

/** Rewrite a per-app bundle's map. `functions` is indexed by the `fn_<index>`
 *  key the function's files were namespaced under. */
export function appSourceMap(
  raw: string,
  functions: readonly SourceMapFunction[],
): string {
  return rewriteSources(raw, (key) => {
    const match = key.match(APP_FUNCTION_PATH);
    const fn = match ? functions[Number(match[1])] : undefined;
    return fn && match ? appPath(fn, match[2]) : undefined;
  });
}

function appPath(fn: SourceMapFunction, key: string): string | undefined {
  if (!Object.hasOwn(fn.files, key)) return undefined;
  return key === fn.entry && fn.entryPath ? fn.entryPath : key;
}

function rewriteSources(
  raw: string,
  appPathOf: (userKey: string) => string | undefined,
): string {
  const map = JSON.parse(raw) as {
    sources?: string[];
    sourceRoot?: string;
    sourcesContent?: unknown;
  };
  map.sources = (map.sources ?? []).map((source) => {
    const app = source.startsWith(USER_PREFIX)
      ? appPathOf(source.slice(USER_PREFIX.length))
      : undefined;
    return app ?? `${INTERNAL_SOURCE_PREFIX}${source}`;
  });
  delete map.sourceRoot;
  delete map.sourcesContent;
  return JSON.stringify(map);
}
