import { isBuiltin } from "node:module";
import type { OnResolveArgs, Plugin } from "esbuild";
import { USER_NAMESPACE } from "./user-files.js";

const REEXPORT_NAMESPACE = "node-builtin-reexport";

// Default export so `require("stream")` is the Stream class, not the namespace.
function reexportStub(specifier: string): string {
  return `import * as builtin from "${specifier}";\nmodule.exports = builtin.default ?? builtin;\n`;
}

// esbuild lowers a CJS `require()` of an external builtin to a `__require()` that
// throws on workerd, so rewrite those to a static import. `isBuiltin` on the full
// specifier rejects `require("string_decoder/")` (the npm package, not the builtin).
export function nodeBuiltinRequirePlugin(): Plugin {
  const onResolve = (args: OnResolveArgs) => {
    if (args.kind !== "require-call" || !isBuiltin(args.path)) {
      return null;
    }
    return { path: args.path, namespace: REEXPORT_NAMESPACE };
  };
  return {
    name: "node-builtin-require",
    setup(build) {
      const filter = /^(node:)?[a-z][a-z0-9._/-]*$/;
      // Default (file) namespace covers deps; user namespace covers the shim and
      // user files now served from memory.
      build.onResolve({ filter }, onResolve);
      build.onResolve({ filter, namespace: USER_NAMESPACE }, onResolve);

      build.onLoad({ filter: /.*/, namespace: REEXPORT_NAMESPACE }, (args) => ({
        contents: reexportStub(args.path),
        loader: "js",
      }));
    },
  };
}
