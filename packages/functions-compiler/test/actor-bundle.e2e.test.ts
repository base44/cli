import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { bundle } from "../src/bundler";
import { STATIC_EGRESS_ARTIFACT_MARKER } from "../src/static-egress";
import { bundleOrThrow } from "./helpers";
import { WFP_COMPAT_DATE } from "./workerd";

describe("actor bundling via base44:runtime/actors", () => {
  it("resolves the Actor base class from the runtime virtual module and bundles the DO wrapper", async () => {
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor {",
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleTick() {}",
      "  handleClose() {}",
      "}",
    ].join("\n");

    // Throws if "base44:runtime/actors" fails to resolve (the whole point of the
    // virtual module) or the generated DO wrapper fails to bundle.
    const module = await bundleOrThrow(src, "base44/actors/GameRoom/entry.ts");

    // The generated wrapper exports the DO class and routes to env["GameRoom"].
    expect(module).toContain("GameRoom");
    expect(module).toContain(STATIC_EGRESS_ARTIFACT_MARKER);
    expect(module.length).toBeGreaterThan(0);
  });

  it("installs static egress before an Actor captures fetch at module scope", async () => {
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      "const capturedFetch = fetch;",
      "export default class GameRoom extends Actor {",
      '  fetch() { return capturedFetch("https://captured.example.com/check"); }',
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleTick() {}",
      "  handleClose() {}",
      "}",
    ].join("\n");
    const module = await bundleOrThrow(src, "base44/actors/GameRoom/entry.ts");
    const staticHosts: string[] = [];
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { GameRoom: "GameRoom" },
      bindings: { BASE44_STATIC_EGRESS_ENABLED: "1" },
      serviceBindings: {
        STATIC_EGRESS: async (request) => {
          const hostname = new URL(request.url).hostname;
          staticHosts.push(hostname);
          return new Response(`static:${hostname}`);
        },
      },
      outboundService: async (request) =>
        new Response(`ordinary:${new URL(request.url).hostname}`),
    });

    try {
      const response = await mf.dispatchFetch(
        "http://localhost/parties/GameRoom/room-a",
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("static:captured.example.com");
      expect(staticHosts).toEqual(["captured.example.com"]);
    } finally {
      await mf.dispose();
    }
  });

  it("routes Actor construction-time fetches through static egress", async () => {
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor {",
      '  fieldFetch = fetch("https://field.example.com/check");',
      "  constructor(ctx, env) {",
      "    super(ctx, env);",
      '    this.constructorFetch = fetch("https://constructor.example.com/check");',
      "  }",
      "  async fetch() {",
      "    const responses = await Promise.all([this.fieldFetch, this.constructorFetch]);",
      "    return new Response(JSON.stringify(await Promise.all(responses.map((response) => response.text()))));",
      "  }",
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleTick() {}",
      "  handleClose() {}",
      "}",
    ].join("\n");
    const module = await bundleOrThrow(src, "base44/actors/GameRoom/entry.ts");
    const staticHosts: string[] = [];
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { GameRoom: "GameRoom" },
      bindings: { BASE44_STATIC_EGRESS_ENABLED: "1" },
      serviceBindings: {
        STATIC_EGRESS: async (request) => {
          const hostname = new URL(request.url).hostname;
          staticHosts.push(hostname);
          return new Response(`static:${hostname}`);
        },
      },
      outboundService: async (request) =>
        new Response(`ordinary:${new URL(request.url).hostname}`),
    });

    try {
      const response = await mf.dispatchFetch(
        "http://localhost/parties/GameRoom/room-a",
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        "static:field.example.com",
        "static:constructor.example.com",
      ]);
      expect(staticHosts).toEqual([
        "field.example.com",
        "constructor.example.com",
      ]);
    } finally {
      await mf.dispose();
    }
  });

  it("resolves a module-scope private data source from the Actor request environment", async () => {
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      'import { http } from "base44:private-data-sources/http";',
      'const source = http("Internal API");',
      "export default class GameRoom extends Actor {",
      '  fetch() { return source.binding.fetch("https://internal.example/health"); }',
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleTick() {}",
      "  handleClose() {}",
      "}",
    ].join("\n");
    const module = await bundleOrThrow(src, "base44/actors/GameRoom/entry.ts");
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { GameRoom: "GameRoom" },
      bindings: {
        BASE44_PRIVATE_DATA_SOURCES: JSON.stringify([
          {
            name: "Internal API",
            type: "http",
            bindingName: "DATA_SOURCE_INTERNAL",
            baseUrl: "https://internal.example",
          },
        ]),
      },
      serviceBindings: {
        DATA_SOURCE_INTERNAL: async (request) =>
          new Response(new URL(request.url).toString()),
      },
    });

    try {
      const response = await mf.dispatchFetch(
        "http://localhost/parties/GameRoom/room-a",
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("https://internal.example/health");
    } finally {
      await mf.dispose();
    }
  });

  it("passes managed bindings to the user Actor unfiltered while retaining runtime access", async () => {
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      'import { http } from "base44:private-data-sources/http";',
      'const source = http("Internal API");',
      "export default class GameRoom extends Actor {",
      "  constructor(ctx, env) {",
      "    super(ctx, env);",
      "    this.visibleEnv = {",
      "      staticEgress: env.STATIC_EGRESS !== undefined,",
      "      enableSecret: env.BASE44_STATIC_EGRESS_ENABLED !== undefined,",
      "      manifest: env.BASE44_PRIVATE_DATA_SOURCES !== undefined,",
      "      dataBinding: env.DATA_SOURCE_INTERNAL !== undefined,",
      "      userValue: env.USER_VALUE,",
      "    };",
      "  }",
      "  async fetch() {",
      '    const response = await source.binding.fetch("https://internal.example/health");',
      "    return Response.json({ visibleEnv: this.visibleEnv, runtimeBody: await response.text() });",
      "  }",
      "}",
    ].join("\n");
    const module = await bundleOrThrow(src, "base44/actors/GameRoom/entry.ts");
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { GameRoom: "GameRoom" },
      bindings: {
        USER_VALUE: "visible",
        BASE44_STATIC_EGRESS_ENABLED: "1",
        BASE44_PRIVATE_DATA_SOURCES: JSON.stringify([
          {
            name: "Internal API",
            type: "http",
            bindingName: "DATA_SOURCE_INTERNAL",
            baseUrl: "https://internal.example",
          },
        ]),
      },
      serviceBindings: {
        STATIC_EGRESS: async () => new Response("static"),
        DATA_SOURCE_INTERNAL: async () => new Response("private"),
      },
    });

    try {
      const response = await mf.dispatchFetch(
        "http://localhost/parties/GameRoom/room-a",
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        visibleEnv: {
          staticEgress: true,
          enableSecret: true,
          manifest: true,
          dataBinding: true,
          userValue: "visible",
        },
        runtimeBody: "private",
      });
    } finally {
      await mf.dispose();
    }
  });

  it("preserves legacy static-egress-named secrets without the managed binding", async () => {
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor {",
      "  constructor(ctx, env) {",
      "    super(ctx, env);",
      "    this.visibleEnv = {",
      "      staticEgress: env.STATIC_EGRESS,",
      "      enableSecret: env.BASE44_STATIC_EGRESS_ENABLED,",
      "      excludedHosts: env.BASE44_STATIC_EGRESS_EXCLUDED_HOSTS,",
      "    };",
      "  }",
      "  fetch() { return Response.json(this.visibleEnv); }",
      "}",
    ].join("\n");
    const module = await bundleOrThrow(src, "base44/actors/GameRoom/entry.ts");
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { GameRoom: "GameRoom" },
      bindings: {
        STATIC_EGRESS: "legacy-network-secret",
        BASE44_STATIC_EGRESS_ENABLED: "legacy-enable-secret",
        BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: "legacy-hosts-secret",
      },
    });

    try {
      const response = await mf.dispatchFetch(
        "http://localhost/parties/GameRoom/room-a",
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        staticEgress: "legacy-network-secret",
        enableSecret: "legacy-enable-secret",
        excludedHosts: "legacy-hosts-secret",
      });
    } finally {
      await mf.dispose();
    }
  });

  it("a named-only export (no default) fails the compile — the wrapper re-exports default", async () => {
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      "export class GameRoom extends Actor { handleConnect() {} }",
    ].join("\n");
    await expect(
      bundleOrThrow(src, "base44/actors/GameRoom/entry.ts"),
    ).rejects.toThrow(/default/i);
  });

  it("rejects runtimeSecrets for an Actor instead of silently ignoring it", async () => {
    // An Actor reads secrets from its Durable Object env, and actor connect dials
    // the dispatcher without a handshake — the activation wrapper cannot serve it.
    // Returning an old-mode bundle here would pair with a backend that already
    // omitted the bindings: an actor with no secrets and no signal why.
    const src = [
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor { handleConnect() {} }",
    ].join("\n");
    const res = await bundle({
      entry: "base44/actors/GameRoom/entry.ts",
      files: { "base44/actors/GameRoom/entry.ts": src },
      runtimeSecrets: true,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe("deno_compat");
    expect(res.errors.map((e) => e.message).join("\n")).toMatch(
      /runtimeSecrets is not supported for Actor/,
    );
  });
});
