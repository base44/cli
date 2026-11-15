import { join } from "node:path";
import { globby } from "globby";
import { pathExists, readTextFile } from "@/core/utils/fs.js";
import type { PageArtifact } from "@/core/version/schema.js";

/**
 * The pages of an app routed by TanStack Router's files, read from `src/routes/`
 * with the router generator's own conventions — no code is run.
 *
 * Names and order match what Base44 shows for the app's pages, because its SEO
 * settings are keyed by them: a name read differently here would detach them.
 */

const ROUTES_DIR = "src/routes";
/** The router plugin writes it on every build, and only for file routes. */
const ROUTE_TREE = "src/routeTree.gen.ts";
const ROUTE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

/** Dots outside `[...]` delimit flat-route segments; brackets escape literally. */
const DOT_SPLIT = /\.(?![^[]*\])/;
const BRACKETS = /\[([^\]]*)\]/g;
/** `{-$x}` (optional) and `prefix{$x}suffix` params, outside brackets. */
const BRACE_PARAM = /\{(-?)\$([^{}[\]]+)\}(?![^[]*\])/;
/** `.lazy` is the base file's route; these are split-file companions. */
const COMPANION_SUFFIXES = new Set([
  "component",
  "errorComponent",
  "notFoundComponent",
  "pendingComponent",
  "loader",
]);
/** A route with `server: { handlers }` and no `component` is an endpoint. */
const SERVER_KEY = /\bserver\s*:\s*\{/;
const COMPONENT_KEY = /\bcomponent['"]?\s*[:,}(]/;

class Segment {
  readonly text: string;
  readonly url: string;
  /** Prefix rules (`_`, `(`, `$`) read the first character only when unescaped. */
  readonly leadEscaped: boolean;
  /** Tokens (`index`, `route`, `lazy`, ...) apply only to an unescaped segment. */
  readonly literal: boolean;

  constructor(raw: string) {
    this.text = raw.replace(BRACKETS, "$1");
    this.leadEscaped = raw.startsWith("[");
    this.literal = raw === this.text;
    // A trailing unescaped `_` only controls nesting; it is not in the URL.
    const name = raw.length > 1 && raw.endsWith("_") ? raw.slice(0, -1) : raw;
    // A brace param takes the whole segment: pages know `:name` and `:name?` only.
    const param = BRACE_PARAM.exec(name);
    this.url = param
      ? `:${param[2]}${param[1] ? "?" : ""}`
      : name.replace(BRACKETS, "$1");
  }

  isToken(...tokens: string[]): boolean {
    return this.literal && tokens.includes(this.text);
  }

  isPathless(): boolean {
    return !this.leadEscaped && this.text.startsWith("_");
  }

  isGroup(): boolean {
    return (
      !this.leadEscaped && this.text.startsWith("(") && this.text.endsWith(")")
    );
  }
}

function segmentsOf(relativePath: string): Segment[] | null {
  const segments: Segment[] = [];
  for (const name of relativePath.split("/")) {
    // Ignored by their file name; a `-` after a dot is an ordinary segment.
    if (name.startsWith("-")) {
      return null;
    }
    for (const raw of name.split(DOT_SPLIT)) {
      if (!raw) {
        continue;
      }
      const segment = new Segment(raw);
      if (
        !segment.text ||
        (!segment.leadEscaped && segment.text.startsWith("__"))
      ) {
        return null;
      }
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments : null;
}

function pageName(parts: string[]): string {
  if (parts.length === 0) {
    return "Home";
  }
  return parts
    .flatMap((part) => part.split(/[^A-Za-z0-9]/))
    .filter(Boolean)
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join("");
}

/**
 * A route file, relative to `src/routes/` and without its extension, as
 * `{ path, name }` — or `null` when it is not a page: a layout, a splat, a
 * companion, `__root`, anything under `api/` or `-` prefixed.
 */
export function pageOfRouteFile(
  relativePath: string,
): { path: string; name: string } | null {
  const segments = segmentsOf(relativePath);
  if (segments === null || segments[0].isToken("api")) {
    return null;
  }
  if (segments[segments.length - 1].isToken("lazy")) {
    segments.pop();
  }
  const last = (): Segment | undefined => segments[segments.length - 1];
  if (last()?.isToken(...COMPANION_SUFFIXES)) {
    return null;
  }
  let poppedIndex = false;
  while (last()?.isToken("index", "route")) {
    poppedIndex ||= last()?.text === "index";
    segments.pop();
  }
  // A layout file (`_auth.jsx`) is not a page; its index child is.
  const end = last();
  if (end && !poppedIndex && (end.isPathless() || end.isGroup())) {
    return null;
  }

  const urlSegments: string[] = [];
  for (const segment of segments) {
    if (segment.isPathless() || segment.isGroup()) {
      continue;
    }
    let url = segment.url;
    if (!segment.leadEscaped && url === "$") {
      return null;
    }
    if (!segment.leadEscaped && url.startsWith("$")) {
      url = `:${url.slice(1)}`;
    }
    urlSegments.push(url);
  }
  return { path: `/${urlSegments.join("/")}`, name: pageName(urlSegments) };
}

function isServerOnly(source: string): boolean {
  return SERVER_KEY.test(source) && !COMPONENT_KEY.test(source);
}

/** Code-point order, as the names' own tie-breaks were decided in. */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The pages, home first: the `/` page, or the first by path. `null` when the
 * app's routes are not TanStack Router files, so its pages cannot be read here.
 */
export async function collectPages(
  projectRoot: string,
): Promise<PageArtifact[] | null> {
  if (!(await pathExists(join(projectRoot, ROUTE_TREE)))) {
    return null;
  }
  const routesDir = join(projectRoot, ROUTES_DIR);
  const files = (await pathExists(routesDir))
    ? await globby("**/*", {
        cwd: routesDir,
        onlyFiles: true,
        followSymbolicLinks: false,
      })
    : [];

  const byPath = new Map<string, { name: string; file: string }>();
  for (const relativeFile of files.sort(byCodePoint)) {
    const extension = ROUTE_EXTENSIONS.find((ext) =>
      relativeFile.endsWith(ext),
    );
    if (!extension || relativeFile.endsWith(".d.ts")) {
      continue;
    }
    const page = pageOfRouteFile(relativeFile.slice(0, -extension.length));
    if (page === null || byPath.has(page.path)) {
      continue;
    }
    if (isServerOnly(await readTextFile(join(routesDir, relativeFile)))) {
      continue;
    }
    byPath.set(page.path, {
      name: page.name,
      file: `${ROUTES_DIR}/${relativeFile}`,
    });
  }

  // Distinct pages keep distinct names, given in this order: `/` first.
  const taken = new Set<string>();
  return [...byPath]
    .sort(([a], [b]) => (a === "/" ? -1 : b === "/" ? 1 : byCodePoint(a, b)))
    .map(([path, { name, file }]) => {
      let unique = name;
      for (let n = 2; taken.has(unique); n++) {
        unique = `${name}${n}`;
      }
      taken.add(unique);
      return { path, name: unique, file };
    });
}
