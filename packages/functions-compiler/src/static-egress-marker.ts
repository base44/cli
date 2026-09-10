// Leaf module: no imports, so the server graph never reaches worker-only code.
// `static-egress.ts` imports the runtime-context virtual specifier, which only
// esbuild (or the vitest alias) can resolve — importing it from a server module
// crashes Node at startup with ERR_UNSUPPORTED_ESM_URL_SCHEME.
// Keep in sync with STATIC_EGRESS_ARTIFACT_MARKER in backend/app/static_egress/config.py.
export const STATIC_EGRESS_ARTIFACT_MARKER =
  "base44.static-egress.request-env.v2";
