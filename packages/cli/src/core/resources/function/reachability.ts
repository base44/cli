import { dirname, extname, relative, resolve } from "node:path";
import { pathExists, readTextFile } from "@/core/utils/fs.js";

// Matches relative specifiers in static/dynamic imports, exports, and require calls.
const RELATIVE_IMPORT_RE =
  /(?:from|import|require)\s*\(?['"`](\.\.?\/[^'"`\s]+)['"`]/g;

async function resolveSpecifier(
  specifier: string,
  fromDir: string,
): Promise<string | null> {
  const base = resolve(fromDir, specifier);
  const ext = extname(base);

  if (ext) {
    // TypeScript projects import .js but ship .ts — try the swap first.
    if (ext === ".js") {
      const asTts = `${base.slice(0, -3)}.ts`;
      if (await pathExists(asTts)) return asTts;
    }
    if (await pathExists(base)) return base;
    return null;
  }

  // No extension — try common TypeScript/JS extensions.
  for (const candidate of [
    `${base}.ts`,
    `${base}.js`,
    `${base}.json`,
    resolve(base, "index.ts"),
    resolve(base, "index.js"),
  ]) {
    if (await pathExists(candidate)) return candidate;
  }

  return null;
}

interface OutOfBoundsImport {
  importer: string;
  specifier: string;
}

interface ReachabilityResult {
  extra: string[];
  outOfBounds: OutOfBoundsImport[];
}

/**
 * Walk the import graph starting from `functionFilePaths` and return any
 * additional files reachable via relative imports that live inside
 * `backendRoot` but outside the original function directory.
 *
 * Also returns out-of-bounds imports — relative specifiers that resolved to a
 * real file but escaped past `backendRoot`. These will be missing at bundle
 * time and will cause a runtime error; callers should warn the user.
 */
export async function collectReachableBackendFiles(
  _entryPath: string,
  functionFilePaths: string[],
  backendRoot: string,
): Promise<ReachabilityResult> {
  const visited = new Set<string>(functionFilePaths);
  const queue: string[] = [...functionFilePaths];
  const extra: string[] = [];
  const outOfBounds: OutOfBoundsImport[] = [];

  while (queue.length > 0) {
    const filePath = queue.shift()!;

    let content: string;
    try {
      content = await readTextFile(filePath);
    } catch {
      continue;
    }

    const dir = dirname(filePath);

    for (const match of content.matchAll(RELATIVE_IMPORT_RE)) {
      const specifier = match[1];

      const resolved = await resolveSpecifier(specifier, dir);
      if (!resolved) continue;

      const rel = relative(backendRoot, resolved);
      if (rel.startsWith("..")) {
        outOfBounds.push({ importer: filePath, specifier });
        continue;
      }

      if (!visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
        extra.push(resolved);
      }
    }
  }

  const functionSet = new Set(functionFilePaths);
  return {
    extra: extra.filter((p) => !functionSet.has(p)),
    outOfBounds,
  };
}
