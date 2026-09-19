import type { BunPlugin } from "bun";

// Runtime dependencies of the local workerd function runtime. They cannot be
// bundled (workerd and esbuild ship native binaries; @deno/loader ships WASM),
// so they are real npm `dependencies` resolved from node_modules at runtime —
// the one deliberate exception to the zero-dependency distribution rule. The
// standalone binary excludes them too and `base44 dev` falls back to the Deno
// runtime there.
export const RUNTIME_EXTERNALS = ["miniflare", "esbuild", "@deno/loader"];

// Ink's dev-only react-devtools bridge would otherwise land in the bundle as
// an eager import of a package we don't ship; the code path is dead outside
// DEV=true, so it compiles to an inert stub. Marking it external instead is
// not enough: the compiled binary hoists the import and fails at startup.
export const stubReactDevtools: BunPlugin = {
  name: "stub-react-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core-stub",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default {}; export const connectToDevTools = () => {};",
      loader: "js",
    }));
  },
};
