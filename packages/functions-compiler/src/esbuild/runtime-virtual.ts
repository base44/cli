import { existsSync, readFileSync } from "node:fs";
import type { Plugin } from "esbuild";

// Keep this allowlist in sync with
// backend/app/cloudflare_functions/code_scan.py (_BASE44_RUNTIME_IMPORT /
// _BASE44_RUNTIME_ACTORS_IMPORT).
const SPECIFIER = "base44:runtime";
// The Actor base class, served for `import { Actor } from "base44:runtime/actors"`.
const ACTORS_SPECIFIER = "base44:runtime/actors";
const NAMESPACE = "base44-runtime";
const MODULE_URL = new URL("../runtime/index.ts", import.meta.url);
// Prebuilt partyserver-backed shim (built by `npm run build:shim`). This file
// lives in src/esbuild/, so dist/ is two levels up (../../), unlike runtime/.
const ACTOR_SHIM_URL = new URL("../../dist/actor.mjs", import.meta.url);

export function runtimeVirtualPlugin(): Plugin {
  return {
    name: "base44-runtime-virtual",
    setup(build) {
      build.onResolve({ filter: /^base44:runtime(?:\/.*)?$/ }, (args) => {
        if (args.path === SPECIFIER || args.path === ACTORS_SPECIFIER) {
          return { path: args.path, namespace: NAMESPACE };
        }
        return {
          errors: [
            {
              text: `Unsupported import "${args.path}". Supported: "${SPECIFIER}" and "${ACTORS_SPECIFIER}".`,
            },
          ],
        };
      });

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        if (args.path === ACTORS_SPECIFIER) {
          // A missing shim would silently bundle a bindingless plain function — fail loud.
          if (!existsSync(ACTOR_SHIM_URL)) {
            return {
              errors: [
                {
                  text:
                    'Import "base44:runtime/actors" requires dist/actor.mjs — ' +
                    "run `npm run build:shim` (with partyserver installed) before bundling.",
                },
              ],
            };
          }
          return {
            contents: readFileSync(ACTOR_SHIM_URL, "utf8"),
            loader: "js",
          };
        }
        return { contents: readFileSync(MODULE_URL, "utf8"), loader: "ts" };
      });
    },
  };
}
