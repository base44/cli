/**
 * Execute a Node-produced bundle inside real workerd via Miniflare.
 *
 * Replaces the old wrangler `unstable_dev` + Worker-Loader runner fixture: now
 * the bundler is a Node service, so we just hand its output string to Miniflare,
 * which hosts it as a worker directly. Pinned to the SAME config WfP uploads
 * with in production (backend/app/cloudflare_functions): main module
 * "_bundled.mjs", compat date 2026-05-18, flags ["nodejs_compat"] — so a green
 * test reflects the real runtime, not an approximation.
 */

import { Miniflare } from "miniflare";

/** Mirror of `cloudflare_wfp_runtime.py` CloudflareWfpRuntime.compatibility_date. */
export const WFP_COMPAT_DATE = "2026-05-18";

interface WorkerdRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Becomes the worker's bindings → `cloudflare:workers` env → `Deno.env`. */
  env?: Record<string, string>;
}

export async function runInWorkerd(
  bundled: string,
  req: WorkerdRequest = {},
): Promise<{ status: number; text: string }> {
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "_bundled.mjs", contents: bundled }],
    compatibilityDate: WFP_COMPAT_DATE,
    compatibilityFlags: ["nodejs_compat"],
    bindings: req.env ?? {},
  });
  try {
    const res = await mf.dispatchFetch(req.url ?? "http://localhost/", {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return { status: res.status, text: await res.text() };
  } finally {
    await mf.dispose();
  }
}
