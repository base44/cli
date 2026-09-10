import { readFileSync } from "node:fs";

import type { Plugin } from "esbuild";

import { PRIVATE_DATA_SOURCES_NAMESPACE } from "./private-data-sources-virtual.js";
import { USER_NAMESPACE } from "./user-files.js";

export const RUNTIME_CONTEXT_SPECIFIER = "base44:internal/runtime-context";

const NAMESPACE = "base44-runtime-context";
const MODULE_URL = new URL("../runtime-context.ts", import.meta.url);
const TRUSTED_USER_IMPORTERS = new Set([
  "__base44_actor_entry.mjs",
  "__base44_actor_prelude.mjs",
  "__base44_deno_shim.mjs",
  "__base44_entry.mjs",
]);

export function runtimeContextVirtualPlugin(): Plugin {
  return {
    name: "base44-runtime-context-virtual",
    setup(build) {
      build.onResolve(
        { filter: /^base44:internal\/runtime-context$/ },
        (args) => {
          const trusted =
            args.namespace === PRIVATE_DATA_SOURCES_NAMESPACE ||
            (args.namespace === USER_NAMESPACE &&
              TRUSTED_USER_IMPORTERS.has(args.importer));
          if (!trusted) {
            return {
              errors: [
                {
                  text: `Unsupported internal runtime import "${args.path}".`,
                },
              ],
            };
          }
          return {
            path: RUNTIME_CONTEXT_SPECIFIER,
            namespace: NAMESPACE,
          };
        },
      );

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: readFileSync(MODULE_URL, "utf8"),
        loader: "ts",
      }));
    },
  };
}
