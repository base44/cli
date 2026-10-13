import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { bundle, bundleApp } from "../src/bundler";
import { bundleOrThrow, bundleAppOrThrow } from "./helpers";
import { WFP_COMPAT_DATE } from "./workerd";

const source = `
import { staticEgress } from "base44:runtime";
export default async function(request) {
  const url = new URL(request.url);
  try {
    const socket = await staticEgress.connect(
      { hostname: url.searchParams.get("host") || "sftp.example.com", port: 2222 },
      { secureTransport: url.searchParams.get("tls") || "off" },
    );
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
      const data = new TextEncoder().encode("SSH-2.0-roundtrip");
      const [, result] = await Promise.all([writer.write(data), reader.read()]);
      return new Response(new TextDecoder().decode(result.value));
    } finally {
      writer.releaseLock();
      reader.releaseLock();
      await socket.close();
    }
  } catch (error) { return new Response(error.message, { status: 409 }); }
}
`;

// Only the network binding is replaced; the compiler, request context and public API are real.
const harness = `
import app from "./app.mjs";
let calls = 0;
let closes = 0;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/counts") return Response.json({ calls, closes });
    const binding = {
      connect(address) {
        if (this !== binding) throw new Error("lost binding receiver");
        calls++;
        const stream = new TransformStream();
        return Promise.resolve({ readable: stream.readable, writable: stream.writable,
          opened: Promise.resolve({}), closed: Promise.resolve(), close: async () => { closes++; } });
      },
    };
    return app.fetch(request, { ...env, STATIC_EGRESS: binding,
      BASE44_STATIC_EGRESS_ENABLED: url.searchParams.get("enabled") || "1",
      BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: '[".base44.app"]',
      BASE44_PRIVATE_DATA_SOURCES: '[{"host":"private.example.com"}]',
    }, ctx);
  },
};
`;

describe("static egress TCP compiled Workers", () => {
  it.each(["single", "per-app"])("round-trips bytes and fails closed in a %s Worker", async (mode) => {
    const compiled = mode === "single"
      ? await bundleOrThrow(source)
      : await bundleAppOrThrow([{ name: "sftp", files: { "main.ts": source } }]);
    const mf = new Miniflare({
      modules: [
        { type: "ESModule", path: "harness.mjs", contents: harness },
        { type: "ESModule", path: "app.mjs", contents: compiled },
      ],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      outboundService: () => { throw new Error("Unexpected direct network fallback"); },
    });
    try {
      const invoke = (query = "") => mf.dispatchFetch(`http://localhost/${query}`, { headers: { "Base44-Function-Name": "sftp" } });
      expect(await (await invoke()).text()).toBe("SSH-2.0-roundtrip");
      for (const query of ["?enabled=0", "?tls=on", "?host=api.base44.app", "?host=private.example.com"]) {
        expect((await invoke(query)).status).toBe(409);
      }
      expect(await (await mf.dispatchFetch("http://localhost/counts")).json()).toEqual({ calls: 1, closes: 1 });
    } finally {
      await mf.dispose();
    }
  });

  it.each([false, true])("does not expose the private manifest store to user code, runtimeSecrets=%s", async (runtimeSecrets) => {
    const files = { "main.ts": 'import { getRuntimeManifest } from "base44:private-data-sources/runtime-manifest-store"; export default () => new Response(getRuntimeManifest());' };
    expect((await bundle({ entry: "main.ts", files, runtimeSecrets })).ok).toBe(false);
    expect((await bundleApp({ functions: [{ name: "probe", entry: "main.ts", files }], runtimeSecrets })).ok).toBe(false);
  });
});
