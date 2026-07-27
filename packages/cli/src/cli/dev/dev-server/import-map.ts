import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";

/** Deno config file names, in the order Deno itself prefers them. */
const DENO_CONFIG_NAMES = ["deno.json", "deno.jsonc"] as const;

interface ImportMap {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

/**
 * Walk up from `startDir` looking for a Deno config file, the same way Deno
 * discovers one from its working directory.
 */
function findDenoConfig(startDir: string): string | null {
  const { root } = parsePath(startDir);
  let dir = startDir;

  while (true) {
    for (const name of DENO_CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve a value against the map it came from. Import map values are relative
 * to their own file, so once entries from two files are combined they have to
 * be absolute or they would silently re-resolve against the merged map.
 * Non-relative specifiers (`npm:`, `jsr:`, bare names, …) are left alone.
 */
function absolutize(value: string, baseUrl: string): string {
  if (!value.startsWith("./") && !value.startsWith("../")) return value;
  return new URL(value, baseUrl).href;
}

function absolutizeEntries(
  entries: Record<string, string>,
  baseUrl: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      absolutize(key, baseUrl),
      absolutize(value, baseUrl),
    ]),
  );
}

function readImportMap(filePath: string): ImportMap {
  const parsed = JSON5.parse(readFileSync(filePath, "utf-8")) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  const { imports, scopes } = parsed as ImportMap;
  return { imports, scopes };
}

/**
 * Build the `--import-map` argument for a locally run backend function.
 *
 * Deno applies exactly one import map, and passing ours would otherwise
 * replace whatever the project defines in its own `deno.json` — breaking
 * aliases that work today. So the project's map is read and merged rather than
 * overridden, with the Base44 entries layered on top. Both sides are made
 * absolute first, because relative entries resolve against the file they were
 * declared in.
 *
 * The result is returned as a `data:` URL so nothing has to be written to disk
 * or cleaned up afterwards.
 */
export function buildImportMapArg(
  baseImportMapPath: string,
  projectDir: string,
): string {
  const baseUrl = pathToFileURL(baseImportMapPath).href;
  const base = readImportMap(baseImportMapPath);

  const merged: Required<ImportMap> = {
    imports: absolutizeEntries(base.imports ?? {}, baseUrl),
    scopes: {},
  };

  const projectConfigPath = findDenoConfig(projectDir);
  if (projectConfigPath) {
    const projectUrl = pathToFileURL(projectConfigPath).href;
    let project: ImportMap = {};
    try {
      project = readImportMap(projectConfigPath);
    } catch {
      // A malformed project config is Deno's problem to report, not a reason
      // to fail the dev server before the function even starts.
      project = {};
    }

    // Project entries first so the Base44 entries win on conflict — a project
    // cannot repoint `base44:runtime` at something that is not the shim.
    merged.imports = {
      ...absolutizeEntries(project.imports ?? {}, projectUrl),
      ...merged.imports,
    };

    for (const [scope, entries] of Object.entries(project.scopes ?? {})) {
      merged.scopes[absolutize(scope, projectUrl)] = absolutizeEntries(
        entries,
        projectUrl,
      );
    }
  }

  const json = JSON.stringify(merged);
  return `data:application/json,${encodeURIComponent(json)}`;
}
