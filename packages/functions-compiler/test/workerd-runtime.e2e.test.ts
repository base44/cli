/**
 * Runtime behavior in real workerd.
 *
 * The bundle-output tests prove the bundler made the right resolution
 * decisions; these prove the bundled output actually *runs* under workerd with
 * `nodejs_compat` — the only thing that catches the runtime-semantics failures
 * the `worker-bundler-fixes` were built for (dynamic-require throws at init,
 * `(0, X.default) is not a function`, tslib interop, the node vs browser module
 * variant, etc.). One representative package per fix, plus Deno.env, the
 * post-install builtin-stub case, and @base44/sdk.
 *
 * Bundling runs in-process via `bundle()`; execution runs in Miniflare-hosted
 * workerd via `runInWorkerd` (see test/workerd.ts), pinned to the production WfP
 * compat config. Hits registry.npmjs.org for each package — hence the long
 * timeouts in vitest.config.ts.
 */

import { describe, expect, it } from "vitest";

import { bundle } from "../src/bundler";
import { CONSOLE_PATCH } from "../src/worker-entry";
import { bundleOrThrow as bundled, bundleAppOrThrow as bundledApp } from "./helpers";
import { runInWorkerd, WFP_COMPAT_DATE } from "./workerd";
import { Miniflare } from "miniflare";

describe("runtime behavior in workerd", () => {
  it("invokes the Deno.serve handler", async () => {
    const m = await bundled('Deno.serve(() => new Response("hello from workerd"));');
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("hello from workerd");
  });

  // Build a minimal bundle using the exact same CONSOLE_PATCH as production,
  // with a handler that returns _b44Store.getStore() so we can assert the env
  // tag without needing to parse workerd log output.
  const envTagBundle = `
import { AsyncLocalStorage } from 'node:async_hooks';
const _b44Store = new AsyncLocalStorage();
const _b44Context = () => _b44Store.getStore();
${CONSOLE_PATCH}
export default {
  async fetch(request) {
    const _b44Env = (request.headers.get('base44-functions-version') ?? '') === 'prod' ? 'prod' : 'preview';
    const functionName = request.headers.get("Base44-Function-Name");
    return _b44Store.run({ env: _b44Env, fn: functionName ?? '' }, () => {
      const store = _b44Store.getStore();
      return Response.json({ env: store.env, fn: store.fn });
    });
  },
};
`;

  it("tags env as 'prod' when base44-functions-version: prod header is present", async () => {
    const { status, text } = await runInWorkerd(envTagBundle, {
      headers: { "base44-functions-version": "prod" },
    });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ env: "prod", fn: "" });
  });

  it("tags env as 'preview' when base44-functions-version header is absent", async () => {
    const { status, text } = await runInWorkerd(envTagBundle, {});
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ env: "preview", fn: "" });
  });

  it("completes Base44.waitUntil work after the response", async () => {
    // Cloudflare cancels promises left pending after the response unless they
    // ride ctx.waitUntil; the prelude's Base44.waitUntil must bridge to it.
    const bundle = `
import { AsyncLocalStorage } from 'node:async_hooks';
const _b44Store = new AsyncLocalStorage();
const _b44Context = () => _b44Store.getStore();
${CONSOLE_PATCH}
let backgroundDone = false;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/check") return Response.json({ backgroundDone });
    return _b44Store.run({ env: 'preview', waitUntil: (p) => ctx.waitUntil(p) }, () => {
      globalThis.Base44.waitUntil((async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        backgroundDone = true;
      })());
      return Response.json({ backgroundDone });
    });
  },
};
`;
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: bundle }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
    });
    try {
      const first = await mf.dispatchFetch("http://localhost/");
      expect(await first.json()).toEqual({ backgroundDone: false });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const second = await mf.dispatchFetch("http://localhost/check");
      expect(await second.json()).toEqual({ backgroundDone: true });
    } finally {
      await mf.dispose();
    }
  });

  it("carries the routed function name in the log context store", async () => {
    const { status, text } = await runInWorkerd(envTagBundle, {
      headers: { "Base44-Function-Name": "inbox-sync" },
    });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ env: "preview", fn: "inbox-sync" });
  });

  it("single-function bundle works with prod header (no regression)", async () => {
    const m = await bundled('Deno.serve(() => new Response("ok"));');
    const { status } = await runInWorkerd(m, {
      headers: { "base44-functions-version": "prod" },
    });
    expect(status).toBe(200);
  });

  it("multi-function bundle routes correctly with prod header (no regression)", async () => {
    const m = await bundledApp([
      { name: "greet", files: { "main.ts": 'Deno.serve(() => new Response("hi"));' } },
    ]);
    const { status } = await runInWorkerd(m, {
      headers: { "base44-functions-version": "prod", "Base44-Function-Name": "greet" },
    });
    expect(status).toBe(200);
  });

  it.each(["single-function", "per-app"] as const)(
    "routes the final %s artifact through handler-env static egress without bypassing telemetry",
    async (mode) => {
      const source = `
        import { http } from "base44:private-data-sources/http";

        const privateSource = http("Internal API");
        const fetchInstances = new Set([globalThis.fetch]);

        Deno.serve(async (request) => {
          fetchInstances.add(globalThis.fetch);
          if (new URL(request.url).pathname === "/detached") {
            fetch("https://detached.example.com/check").catch(() => {});
            return new Response("detached");
          }
          const responses = await Promise.all([
            fetch("https://string.example.com/check"),
            fetch(new URL("https://url.example.com/check")),
            fetch(new Request("https://request.example.com/check")),
            fetch("https://private.example.com/global"),
            fetch("https://api.base44.app/platform"),
            privateSource.fetch("/direct"),
          ]);
          const [stringFetch, urlFetch, requestFetch, privateGlobal, platformGlobal,
            privateDirect] = await Promise.all(
              responses.map((response) => response.text()),
            );
          return Response.json({
            fetchInstances: fetchInstances.size,
            stringFetch,
            urlFetch,
            requestFetch,
            privateGlobal,
            platformGlobal,
            privateDirect,
          });
        });
      `;
      const module =
        mode === "single-function"
          ? await bundled(source, "main.ts", true)
          : await bundledApp(
              [{ name: "probe", files: { "main.ts": source } }],
              true,
            );
      expect(module).not.toContain("cloudflare:workers");
      expect(module).not.toContain("base44.workerEnvironment");
      expect(module).toContain("STATIC_EGRESS");
      expect(module).toContain("post_response_work");

      const manifest = JSON.stringify([
        {
          name: "Internal API",
          type: "http",
          bindingName: "DATA_SOURCE_INTERNAL",
          bindingKind: "vpc_service",
          host: "private.example.com",
          port: 443,
          baseUrl: "https://private.example.com",
        },
      ]);
      const staticHosts: string[] = [];
      const mf = new Miniflare({
        modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
        compatibilityDate: WFP_COMPAT_DATE,
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          BASE44_PRIVATE_DATA_SOURCES: manifest,
          BASE44_STATIC_EGRESS_ENABLED: "1",
          BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: JSON.stringify([".base44.app"]),
        },
        serviceBindings: {
          STATIC_EGRESS: async (request) => {
            const hostname = new URL(request.url).hostname;
            staticHosts.push(hostname);
            if (hostname === "detached.example.com") {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return new Response(`static:${hostname}`);
          },
          DATA_SOURCE_INTERNAL: async (request) =>
            new Response(`pds:${new URL(request.url).hostname}`),
        },
        outboundService: async (request) =>
          new Response(`ordinary:${new URL(request.url).hostname}`),
      });

      try {
        const headers =
          mode === "per-app" ? { "Base44-Function-Name": "probe" } : undefined;
        const responses = await Promise.all([
          mf.dispatchFetch("http://localhost/", { headers }),
          mf.dispatchFetch("http://localhost/", { headers }),
        ]);
        for (const response of responses) {
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({
            fetchInstances: 1,
            stringFetch: "static:string.example.com",
            urlFetch: "static:url.example.com",
            requestFetch: "static:request.example.com",
            privateGlobal: "ordinary:private.example.com",
            platformGlobal: "ordinary:api.base44.app",
            privateDirect: "pds:private.example.com",
          });
        }

        const detached = await mf.dispatchFetch("http://localhost/detached", {
          headers,
        });
        expect(detached.status).toBe(200);
        expect(await detached.text()).toBe("detached");
        const telemetry = JSON.parse(
          detached.headers.get("X-B44-Post-Response-Telemetry")!,
        );
        expect(telemetry.pending.targets).toEqual([
          "https://detached.example.com",
        ]);
        expect(staticHosts).toContain("detached.example.com");
      } finally {
        await mf.dispose();
      }
    },
  );
  // ── base44:runtime + export-default handler contract ──────────────────────

  it("uses native fetch for every input form when the final artifact has no binding", async () => {
    const module = await bundled(
      `
        Deno.serve(async () => {
          const responses = await Promise.all([
            fetch("https://string.example.com/check"),
            fetch(new URL("https://url.example.com/check")),
            fetch(new Request("https://request.example.com/check")),
          ]);
          return Response.json(await Promise.all(
            responses.map((response) => response.text()),
          ));
        });
      `,
      "main.ts",
      true,
    );
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      outboundService: async (request) =>
        new Response(`ordinary:${new URL(request.url).hostname}`),
    });

    try {
      const response = await mf.dispatchFetch("http://localhost/");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        "ordinary:string.example.com",
        "ordinary:url.example.com",
        "ordinary:request.example.com",
      ]);
    } finally {
      await mf.dispose();
    }
  });

  it("serves a default-exported handler (no Deno.serve)", async () => {
    const m = await bundled(`
      export default async function (req: Request): Promise<Response> {
        return new Response("default export served");
      }
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("default export served");
  });

  it("prefers the Deno.serve capture over a default export", async () => {
    const m = await bundled(`
      Deno.serve(() => new Response("from serve"));
      export default () => new Response("from default");
    `);
    const { text } = await runInWorkerd(m);
    expect(text).toBe("from serve");
  });

  it("returns 503 when a function has neither Deno.serve nor a default export", async () => {
    const m = await bundled("export const x = 1;");
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(503);
    expect(text).toContain("export default a request handler or call Deno.serve()");
  });

  it("routes a default-exported handler in a per-app bundle", async () => {
    const m = await bundledApp([
      {
        name: "modern",
        files: { "main.ts": "export default () => new Response('modern');" },
      },
      { name: "legacy", files: { "main.ts": 'Deno.serve(() => new Response("legacy"));' } },
    ]);
    const modern = await runInWorkerd(m, {
      headers: { "Base44-Function-Name": "modern" },
    });
    expect(modern).toEqual({ status: 200, text: "modern" });
    const legacy = await runInWorkerd(m, {
      headers: { "Base44-Function-Name": "legacy" },
    });
    expect(legacy).toEqual({ status: 200, text: "legacy" });
  });

  it("reads secrets via base44:runtime from the Worker env binding", async () => {
    const m = await bundled(`
      import { secrets } from "base44:runtime";
      export default () => Response.json({
        secret: secrets.get("MY_SECRET"),
        missing: secrets.get("NOT_SET") ?? null,
      });
    `);
    const { status, text } = await runInWorkerd(m, { env: { MY_SECRET: "sekret-123" } });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ secret: "sekret-123", missing: null });
  });

  it("does NOT expose the reserved private-data-sources manifest via secrets.get", async () => {
    // The manifest carries plaintext VPC DB credentials; user code reaches data
    // sources via base44:private-data-sources/* imports, never the raw manifest.
    const m = await bundled(`
      import { secrets } from "base44:runtime";
      export default () => Response.json({
        manifest: secrets.get("BASE44_PRIVATE_DATA_SOURCES") ?? null,
        realSecret: secrets.get("MY_SECRET") ?? null,
      });
    `);
    const { status, text } = await runInWorkerd(m, {
      env: {
        BASE44_PRIVATE_DATA_SOURCES: JSON.stringify([{ name: "db", password: "leak-me" }]),
        MY_SECRET: "ok",
      },
    });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ manifest: null, realSecret: "ok" });
  });

  it("does not leak the manifest via a boxed-String key (coercion bypass)", async () => {
    // `new String("BASE44_...")` fails Set.has (object identity) but coerces to
    // the reserved key on the env lookup — String(n) must close that path.
    const m = await bundled(`
      import { secrets } from "base44:runtime";
      export default () => Response.json({
        boxed: (secrets.get as any)(new String("BASE44_PRIVATE_DATA_SOURCES")) ?? null,
      });
    `);
    const { status, text } = await runInWorkerd(m, {
      env: { BASE44_PRIVATE_DATA_SOURCES: JSON.stringify([{ password: "leak-me" }]) },
    });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ boxed: null });
  });

  it("completes base44:runtime waitUntil work after the response and returns the promise", async () => {
    const m = await bundled(`
      import { waitUntil } from "base44:runtime";
      let backgroundDone = false;
      export default async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === "/check") return Response.json({ backgroundDone });
        const p = waitUntil((async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          backgroundDone = true;
          return "done";
        })());
        return Response.json({ returnsPromise: typeof p?.then === "function", backgroundDone });
      };
    `);
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: m }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
    });
    try {
      const first = await mf.dispatchFetch("http://localhost/");
      expect(await first.json()).toEqual({ returnsPromise: true, backgroundDone: false });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const second = await mf.dispatchFetch("http://localhost/check");
      expect(await second.json()).toEqual({ backgroundDone: true });
    } finally {
      await mf.dispose();
    }
  });

  it("supports the EdgeRuntime.waitUntil compat alias", async () => {
    const m = await bundled(`
      export default () => {
        const er = (globalThis as any).EdgeRuntime;
        er.waitUntil(Promise.resolve());
        return Response.json({ hasAlias: typeof er?.waitUntil === "function" });
      };
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ hasAlias: true });
  });

  it("reads Deno.env at top level and inside the handler", async () => {
    const m = await bundled(`
      const TOP = Deno.env.get("MY_SECRET");
      Deno.serve(() => Response.json({
        top: TOP,
        inHandler: Deno.env.get("MY_SECRET"),
        has: Deno.env.has("MY_SECRET"),
        missing: Deno.env.get("NOT_SET") ?? null,
      }));
    `);
    const { status, text } = await runInWorkerd(m, { env: { MY_SECRET: "sekret-123" } });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      top: "sekret-123",
      inHandler: "sekret-123",
      has: true,
      missing: null,
    });
  });

  it("rejects ambiguous private data source name lookups", async () => {
    const m = await bundled(`
      import { http } from "base44:private-data-sources/http";

      Deno.serve(() => {
        try {
          http("Sales API");
          return new Response("unexpected", { status: 200 });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), { status: 409 });
        }
      });
    `);
    const manifest = JSON.stringify([
      {
        name: "Sales API",
        type: "http",
        bindingName: "DATA_SOURCE_SALES_A",
        bindingKind: "vpc_service",
        host: "sales-a.internal",
        port: 80,
        baseUrl: "http://sales-a.internal:80"
      },
      {
        name: "Sales API",
        type: "http",
        bindingName: "DATA_SOURCE_SALES_B",
        bindingKind: "vpc_service",
        host: "sales-b.internal",
        port: 80,
        baseUrl: "http://sales-b.internal:80"
      }
    ]);

    const { status, text } = await runInWorkerd(m, {
      env: { BASE44_PRIVATE_DATA_SOURCES: manifest },
    });

    expect(status).toBe(409);
    expect(text).toContain('Private data source "Sales API" is ambiguous');
  });

  it("passes Redis manifest credentials through ioredis options", async () => {
    const m = await bundled(`
      import { redis } from "base44:private-data-sources/redis";

      Deno.serve(() => {
        const options = redis("Cache").ioredisOptions();
        return Response.json({
          username: options.username,
          password: options.password,
          connectorType: typeof options.Connector,
        });
      });
    `);
    const manifest = JSON.stringify([{
      name: "Cache",
      type: "redis",
      bindingName: "DATA_SOURCE_REDIS",
      bindingKind: "vpc_service",
      host: "redis.internal",
      port: 6379,
      username: "acl_user",
      password: "redis-secret",
    }]);

    const { status, text } = await runInWorkerd(m, {
      env: {
        BASE44_PRIVATE_DATA_SOURCES: manifest,
        DATA_SOURCE_REDIS: "bound",
      },
    });

    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      username: "acl_user",
      password: "redis-secret",
      connectorType: "function",
    });
  });

  it("leaves credentials out of ioredis options for unauthenticated Redis", async () => {
    const m = await bundled(`
      import { redis } from "base44:private-data-sources/redis";

      Deno.serve(() => {
        const options = redis("Cache").ioredisOptions();
        return Response.json({
          hasUsername: "username" in options,
          hasPassword: "password" in options,
          connectorType: typeof options.Connector,
        });
      });
    `);
    const manifest = JSON.stringify([{
      name: "Cache",
      type: "redis",
      bindingName: "DATA_SOURCE_REDIS",
      bindingKind: "vpc_service",
      host: "redis.internal",
      port: 6379,
    }]);

    const { status, text } = await runInWorkerd(m, {
      env: {
        BASE44_PRIVATE_DATA_SOURCES: manifest,
        DATA_SOURCE_REDIS: "bound",
      },
    });

    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      hasUsername: false,
      hasPassword: false,
      connectorType: "function",
    });
  });

  it("does not emit a Redis username without a password", async () => {
    const m = await bundled(`
      import { redis } from "base44:private-data-sources/redis";

      Deno.serve(() => {
        const options = redis("Cache").ioredisOptions();
        return Response.json({
          hasUsername: "username" in options,
          hasPassword: "password" in options,
        });
      });
    `);
    const manifest = JSON.stringify([{
      name: "Cache",
      type: "redis",
      bindingName: "DATA_SOURCE_REDIS",
      bindingKind: "vpc_service",
      host: "redis.internal",
      port: 6379,
      username: "acl_user",
    }]);

    const { status, text } = await runInWorkerd(m, {
      env: {
        BASE44_PRIVATE_DATA_SOURCES: manifest,
        DATA_SOURCE_REDIS: "bound",
      },
    });

    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      hasUsername: false,
      hasPassword: false,
    });
  });

  // ── Post-response detached-work telemetry ─────────────────────────────────
  // Runs a real bundle in workerd and captures runtime stdio: telemetry lines
  // go through the console patch, so they land in workerd's stdout.

  async function runCapturingLogs(
    bundle: string,
    headers: Record<string, string> = {},
  ): Promise<{ logs: string; telemetryHeader: string | null }> {
    const chunks: string[] = [];
    let telemetryHeader: string | null = null;
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: bundle }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      handleRuntimeStdio(stdout, stderr) {
        stdout.on("data", (d) => chunks.push(String(d)));
        stderr.on("data", (d) => chunks.push(String(d)));
      },
    });
    try {
      const res = await mf.dispatchFetch("http://localhost/", { headers });
      expect(res.status).toBe(200);
      telemetryHeader = res.headers.get("X-B44-Post-Response-Telemetry");
      // Let waitUntil-sanctioned background work (if any) run before teardown.
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      await mf.dispose();
    }
    return { logs: chunks.join(""), telemetryHeader };
  }

  it("logs inflight_at_response for detached fetches workerd will cancel", async () => {
    const m = await bundled(`
      Deno.serve(() => {
        // The lunair shape: fire-and-forget fetch, response returned first.
        fetch("http://127.0.0.1:1/unreachable").catch(() => {});
        return new Response("ok");
      });
    `, "main.ts", true);
    const { logs, telemetryHeader } = await runCapturingLogs(m);
    expect(logs).toContain("inflight_at_response");
    // The only trace of unsanctioned work is this line — it must name what
    // workerd is about to cancel.
    expect(logs).toContain('"targets":["http://127.0.0.1:1"]');
    // The same signal rides the response header for the Datadog bridge.
    expect(telemetryHeader).not.toBeNull();
    const relayed = JSON.parse(telemetryHeader!);
    expect(relayed.pending.targets).toEqual(["http://127.0.0.1:1"]);
    // Deliberate fire-and-forget has no pre-response rejection and no
    // pre-response non-ok resolution — the discriminators that keep the
    // target population flagged.
    expect(relayed.pending.rejected_pre_response).toBe(false);
    expect(relayed.pending.non_ok_pre_response).toBe(false);
  });

  it("flags Promise.all fail-fast fallout via rejected_pre_response", async () => {
    // The accidental-orphan shape: parallel fetches, one rejects before the
    // handler responds, siblings still in flight at response. The pre-response
    // rejection separates this from deliberate fire-and-forget (above), even
    // when the handler swallows the error and still returns a 2xx.
    const m = await bundled(`
      Deno.serve(async () => {
        fetch("http://upstream/sibling").catch(() => {});
        const ac = new AbortController();
        const doomed = fetch("http://upstream/doomed", { signal: ac.signal });
        ac.abort();
        try { await doomed; } catch (e) {}
        return new Response("degraded");
      });
    `, "main.ts", true);
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: m }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      // The sibling never settles — pending at response by construction.
      outboundService: () => new Promise<Response>(() => {}),
    });
    try {
      const res = await mf.dispatchFetch("http://localhost/");
      expect(res.status).toBe(200);
      const relayed = JSON.parse(res.headers.get("X-B44-Post-Response-Telemetry")!);
      expect(relayed.pending.rejected_pre_response).toBe(true);
      expect(relayed.pending.targets).toEqual(["http://upstream"]);
    } finally {
      await mf.dispose();
    }
  });

  it("flags app-level fail-fast via non_ok_pre_response", async () => {
    // The SDK/helper shape: the fetch RESOLVES with a non-ok status, a wrapper
    // throws on !res.ok, Promise.all fail-fasts, the handler catches and still
    // returns 2xx with the sibling orphaned. The fetch promise never rejected,
    // so rejected_pre_response can't see it — non_ok_pre_response does.
    const m = await bundled(`
      Deno.serve(async () => {
        const read = async (path) => {
          const res = await fetch("http://upstream" + path);
          if (!res.ok) throw new Error("upstream " + res.status);
          return res;
        };
        try {
          await Promise.all([read("/hang"), read("/rate-limited")]);
          return new Response("unexpected-ok");
        } catch (e) {
          return new Response("degraded");
        }
      });
    `, "main.ts", true);
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: m }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      outboundService: (req) =>
        new URL(req.url).pathname === "/rate-limited"
          ? new Response("slow down", { status: 429 })
          : new Promise<Response>(() => {}), // sibling never settles
    });
    try {
      const res = await mf.dispatchFetch("http://localhost/");
      expect(res.status).toBe(200);
      const relayed = JSON.parse(res.headers.get("X-B44-Post-Response-Telemetry")!);
      expect(relayed.pending.non_ok_pre_response).toBe(true);
      expect(relayed.pending.rejected_pre_response).toBe(false);
      expect(relayed.pending.targets).toEqual(["http://upstream"]);
    } finally {
      await mf.dispose();
    }
  });

  it("keeps a detached fetch chain alive WITHOUT user-code waitUntil", async () => {
    // The overload rides ctx.waitUntil on every observed fetch, so a plain
    // fire-and-forget chain survives the response: fetch A (pending at
    // response) completes instead of being cancelled, its continuation runs,
    // and fetch B is both issued upstream and logged as post-response.
    const m = await bundled(`
      Deno.serve(() => {
        (async () => {
          await fetch("http://upstream/a").catch(() => {});
          await fetch("http://upstream/b").catch(() => {});
        })();
        return new Response("ok");
      });
    `, "main.ts", true);
    const seen: string[] = [];
    const chunks: string[] = [];
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: m }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      handleRuntimeStdio(stdout, stderr) {
        stdout.on("data", (d) => chunks.push(String(d)));
        stderr.on("data", (d) => chunks.push(String(d)));
      },
      outboundService: async (req) => {
        seen.push(new URL(req.url).pathname);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Response("ok");
      },
    });
    try {
      const res = await mf.dispatchFetch("http://localhost/");
      expect(res.status).toBe(200);
      // fetch A was pending at response — reported.
      const relayed = JSON.parse(res.headers.get("X-B44-Post-Response-Telemetry")!);
      expect(relayed.pending.targets).toEqual(["http://upstream"]);
      // Give the kept-alive chain time to run its continuation.
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      await mf.dispose();
    }
    // Without the platform-side waitUntil ride, workerd cancels the chain
    // after A and /b is never requested.
    expect(seen).toEqual(["/a", "/b"]);
    expect(chunks.join("")).toContain("fetch_started_post_response");
  });

  it("emits no telemetry for a clean request", async () => {
    const m = await bundled(`
      Deno.serve(async () => {
        try { await fetch("http://127.0.0.1:1/x"); } catch (e) {}
        return new Response("ok");
      });
    `, "main.ts", true);
    const { logs, telemetryHeader } = await runCapturingLogs(m);
    expect(logs).not.toContain("b44_telemetry");
    expect(telemetryHeader).toBeNull();
  });

  it("per-app topology: signals carry function attribution, clean sibling silent", async () => {
    // Production CFW runs the per-app (multi-function) entry — a separate
    // template from the single-function path.
    const m = await bundledApp([
      { name: "detached-fn", files: { "main.ts": `
        Deno.serve(() => {
          fetch("http://127.0.0.1:1/unreachable").catch(() => {});
          return new Response("ok");
        });
      ` } },
      { name: "clean-fn", files: { "main.ts": 'Deno.serve(() => new Response("ok"));' } },
    ], true);
    const chunks: string[] = [];
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: m }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      handleRuntimeStdio(stdout, stderr) {
        stdout.on("data", (d) => chunks.push(String(d)));
        stderr.on("data", (d) => chunks.push(String(d)));
      },
    });
    try {
      const detached = await mf.dispatchFetch("http://localhost/", {
        headers: { "Base44-Function-Name": "detached-fn" },
      });
      expect(detached.status).toBe(200);
      const relayed = JSON.parse(detached.headers.get("X-B44-Post-Response-Telemetry")!);
      expect(relayed.pending.targets).toEqual(["http://127.0.0.1:1"]);

      const clean = await mf.dispatchFetch("http://localhost/", {
        headers: { "Base44-Function-Name": "clean-fn" },
      });
      expect(clean.status).toBe(200);
      expect(clean.headers.get("X-B44-Post-Response-Telemetry")).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      await mf.dispose();
    }
    const logs = chunks.join("");
    expect(logs).toContain("inflight_at_response");
    expect(logs).toContain("_b44_function: 'detached-fn'");
    expect(logs).not.toContain("_b44_function: 'clean-fn'");
  });

  it("flag off (default): detached fetches emit no telemetry — prod baseline", async () => {
    const m = await bundled(`
      Deno.serve(() => {
        fetch("http://127.0.0.1:1/unreachable").catch(() => {});
        return new Response("ok");
      });
    `);
    const { logs, telemetryHeader } = await runCapturingLogs(m);
    expect(logs).not.toContain("b44_telemetry");
    expect(telemetryHeader).toBeNull();
  });

  it("flag-off module carries no telemetry artifacts (prod-baseline bytes)", async () => {
    const src = 'Deno.serve(() => new Response("ok"));';
    const off = await bundled(src);
    for (const marker of ["post_response_work", "_b44OnResponded", "_b44AttachTelemetry", "randomUUID", "inflightTargets"]) {
      expect(off, `flag-off module must not contain ${marker}`).not.toContain(marker);
    }
    const on = await bundled(src, "main.ts", true);
    expect(on).toContain("post_response_work");
  });

  it("keeps duplicate in-flight targets until the last sibling settles", async () => {
    // Two overlapping fetches to the same origin+path; the FIRST settles
    // before the response while the second stays pending. Refcounting must
    // keep the target in the report — a plain Set deletes it on the first
    // settle and reports inflight=1 with empty targets. Settlement order is
    // driven deterministically from the test via outboundService.
    const m = await bundled(`
      Deno.serve(async () => {
        const first = fetch("http://upstream/dup").catch(() => {});
        fetch("http://upstream/dup").catch(() => {});
        await first; // settles when the test releases it; sibling never does
        return new Response("ok");
      });
    `, "main.ts", true);
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: m }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      outboundService: async () => {
        calls += 1;
        if (calls === 1) {
          await released;
          return new Response("first");
        }
        return new Promise<Response>(() => {}); // sibling: never settles
      },
    });
    try {
      const dispatched = mf.dispatchFetch("http://localhost/");
      setTimeout(release, 100);
      const res = await dispatched;
      expect(res.status).toBe(200);
      const relayed = JSON.parse(res.headers.get("X-B44-Post-Response-Telemetry")!);
      expect(relayed.pending.inflight).toBe(1);
      expect(relayed.pending.targets).toEqual(["http://upstream"]);
    } finally {
      await mf.dispose();
    }
  });

  // Issue 1 — extensionless entry (entry-extensions). form-data's entry
  // (`browser`/`main`) has no extension; without the fix it's "No such module
  // form-data" at import. In a browser-targeted bundle the `browser` field
  // resolves to form-data's browser entry (native web FormData in workerd), so
  // we assert the universal `.append`, not the Node-only `.getBoundary`.
  it("form-data: extensionless entry resolves and constructs (#1)", async () => {
    const m = await bundled(`
      import FormData from "npm:form-data@4.0.5";
      Deno.serve(() => new Response(String(
        typeof FormData === "function" && typeof new FormData().append === "function"
      )));
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  // Issue 2 — browser field (axios's node http adapter must be excluded, else
  // it pulls node http and crashes at module init).
  it("axios: browser build loads without the node adapter (#2)", async () => {
    const m = await bundled(`
      import axios from "npm:axios@1.7.7";
      Deno.serve(() => new Response(String(
        typeof axios.get === "function" && typeof axios.create === "function"
      )));
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  it("mysql2: an undeclared optional require takes its runtime fallback", async () => {
    const m = await bundled(`
      import mysql from "npm:mysql2@3.13.0";
      Deno.serve(() => new Response(mysql.escape("O'Reilly")));
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("'O\\'Reilly'");
  });

  // Issue 3 — node condition wins (engine.io-client's node build does
  // require("fs") via ws; the browser build uses native WebSocket/fetch).
  it("engine.io-client: browser build loads (no require('fs') at init) (#3)", async () => {
    const m = await bundled(`
      import { Socket } from "npm:engine.io-client@^6.6.0";
      Deno.serve(() => new Response(String(typeof Socket === "function")));
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  // Issue 4 — subpath imports of a no-`exports` package (synthesize-exports).
  // Wrong resolution binds to validator/index.js → not a function.
  it("validator: deep subpath import resolves and runs (#4)", async () => {
    const m = await bundled(`
      import isEmail from "npm:validator@13.12.0/lib/isEmail.js";
      Deno.serve(() => new Response(String(isEmail("a@b.com") === true && isEmail("nope") === false)));
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  // Issue 5 — CJS require() of node builtins (node-builtin plugin). safe-buffer
  // does require("buffer") at init; without the stub it throws at load.
  it("jsonwebtoken: CJS require() of node builtins works at runtime (#5)", async () => {
    const m = await bundled(`
      import jwt from "npm:jsonwebtoken@9.0.2";
      Deno.serve(() => {
        const token = jwt.sign({ a: 1 }, "k");
        return new Response(String(token.split(".").length === 3));
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  // require() of a builtin resolves to a static import instead of crashing
  // with "Dynamic require of X is not supported" — bare and `node:`-prefixed,
  // including a subpath (fs/promises) that must survive to the re-export.
  it("CJS require() of any node builtin resolves (fs, fs/promises, os) (#5)", async () => {
    const m = await bundled(`
      const os = require("os");
      const fs = require("fs");
      const fsp = require("fs/promises");
      const nfs = require("node:fs");
      const nfsp = require("node:fs/promises");
      Deno.serve(() => Response.json({
        fs: typeof fs.readFileSync,
        fsp: typeof fsp.readFile,
        os: typeof os.platform,
        nfs: typeof nfs.readFileSync,
        nfsp: typeof nfsp.readFile,
      }));
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      fs: "function",
      fsp: "function",
      os: "function",
      nfs: "function",
      nfsp: "function",
    });
  });

  // Issue 6 — node-ESM wrapper interop (prefer-module-condition). pdf-lib → tslib;
  // wrong interop is "Cannot destructure property '__extends'".
  it("pdf-lib: tslib interop works (creates + saves a PDF) (#6)", async () => {
    const m = await bundled(`
      import { PDFDocument } from "npm:pdf-lib@1.17.1";
      Deno.serve(async () => {
        const doc = await PDFDocument.create();
        doc.addPage();
        const bytes = await doc.save();
        return new Response(String(bytes.length > 0));
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  // A real npm package named like a builtin (process) must win over the
  // builtin, subpath included. Import path — esbuild resolves it directly; the
  // plugin's guard is require()-only, so this pins plain resolution.
  it("process/browser: real npm package wins over the builtin (import)", async () => {
    const m = await bundled(`
      import proc from "npm:process@0.11.10/browser";
      Deno.serve(() => Response.json({
        title: proc.title,
        hasNextTick: typeof proc.nextTick === "function",
      }));
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ title: "browser", hasNextTick: true });
  });

  // With Deno's resolver a *bare* require() of a name that is also a node
  // builtin resolves to the builtin: a side-effect `import "npm:process"` does
  // not remap the bare specifier (unlike the old flat-node_modules model). So
  // workerd's process is returned (no `browser` field). To use a builtin-named
  // npm package, import it explicitly via npm: — see the import-side test above,
  // which passes. This documents the intended behavior change.
  it("process: bare require() of a builtin name resolves to the builtin", async () => {
    const m = await bundled(`
      import "npm:process@0.11.10";
      Deno.serve(() => {
        const proc = require("process");
        return Response.json({
          browser: proc.browser ?? null,
          hasNextTick: typeof proc.nextTick === "function",
        });
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ browser: null, hasNextTick: true });
  });

  // #17077 — jimp@0.16.13 has entry in `main`/`module` and no root index.js;
  // the package.json entry fallback resolves the whole graph (end-to-end
  // execution is covered by the package matrix).
  it("jimp: package with main/module but no root index.js bundles (#7)", async () => {
    const r = await bundle({
      entry: "main.ts",
      files: {
        "main.ts": `
          import Jimp from "npm:jimp@0.16.13";
          Deno.serve(() => new Response(String(typeof Jimp)));
        `,
      },
      postResponseTelemetry: false,
    });
    expect(r.ok, r.ok ? "" : r.errors.map((e) => e.message).join("\n")).toBe(
      true,
    );
  });

  // Exercises the fixes together (SDK pulls axios + socket.io-client + uuid):
  // the bundle must evaluate and instantiate the client.
  it("@base44/sdk: createClientFromRequest evaluates and instantiates", async () => {
    const m = await bundled(`
      import { createClientFromRequest } from "npm:@base44/sdk@^0.8.30";
      Deno.serve((req) => {
        const c = createClientFromRequest(req);
        return Response.json({
          hasAuthMe: typeof c?.auth?.me === "function",
          hasEntities: c?.entities !== undefined && typeof c.entities === "object",
          hasFunctionsInvoke: typeof c?.functions?.invoke === "function",
        });
      });
    `);
    const { status, text } = await runInWorkerd(m, {
      headers: { "Base44-App-Id": "test-app-123", Authorization: "Bearer fake-user-token" },
    });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      hasAuthMe: true,
      hasEntities: true,
      hasFunctionsInvoke: true,
    });
  });
});
