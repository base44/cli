import { ASSETS } from "./generated/assets.js";

/**
 * A file the compiler injects into a build or serves to one, embedded as text by
 * scripts/build-shim.ts. The compiler reads no file of its own, so a consumer can
 * bundle it anywhere — a path relative to `import.meta.url` stops naming the
 * file once it has been bundled.
 */
export function asset(name: string): string {
  const text = ASSETS[name];
  if (text === undefined) {
    throw new Error(
      `Missing compiler asset "${name}" — run \`bun run build:shim\`.`,
    );
  }
  return text;
}
