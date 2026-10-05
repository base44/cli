import type { Plugin } from "esbuild";
import { asset } from "../assets.js";

// Keep this allowlist in sync with
// backend/app/cloudflare_functions/code_scan.py (_BASE44_RUNTIME_IMPORT /
// _BASE44_RUNTIME_ACTORS_IMPORT).
const SPECIFIER = "base44:runtime";
// The Actor base class, served for `import { Actor } from "base44:runtime/actors"`.
const ACTORS_SPECIFIER = "base44:runtime/actors";
const NAMESPACE = "base44-runtime";

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
          // The prebuilt partyserver-backed shim.
          return { contents: asset("actor.mjs"), loader: "js" };
        }
        return { contents: asset("runtime/index.ts"), loader: "ts" };
      });
    },
  };
}
