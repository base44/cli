import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { bundle } from "../src/bundler";
import { STATIC_EGRESS_ARTIFACT_MARKER } from "../src/static-egress";
import { bundleOrThrow } from "./helpers";
import { WFP_COMPAT_DATE } from "./workerd";

const APP_ID = "0123456789abcdef01234567";
const SCRIPT_ID = "actor-p-0123456789abcdef01234567-aaaaaaaaaaaaaaaaaaaaaaaaaa";

async function actorKeypair(): Promise<{ sign: (claims: object) => Promise<string>; publicKey: string }> {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    publicKey: Buffer.from(await crypto.subtle.exportKey("raw", publicKey)).toString("base64url"),
    sign: async (claims) => {
      const input = `${encode({ alg: "EdDSA", typ: "JWT" })}.${encode(claims)}`;
      const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(input));
      return `${input}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}

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

  async function actorWorker(src: string) {
    const module = await bundleOrThrow(src, "base44/actors/GameRoom/entry.ts");
    const { sign, publicKey } = await actorKeypair();
    const now = Math.floor(Date.now() / 1_000);
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { GameRoom: "GameRoom" },
      bindings: {
        BASE44_APP_ID: APP_ID,
        BASE44_ACTOR_SCRIPT_ID: SCRIPT_ID,
        BASE44_ACTOR_PUBLIC_KEY: publicKey,
        BASE44_FUNCTIONS_VERSION: "prod",
      },
    });
    const requestToken = async (room: string, body: string, principal: object = { type: "service" }) =>
      sign({
        iss: "base44", aud: "base44-actor-request", purpose: "actor-request", v: 1,
        iat: now, nbf: now, exp: now + 60, jti: `jti-${room}`,
        app_id: APP_ID, actor_name: "GameRoom", actor_script_id: SCRIPT_ID, room, runtime_mode: "prod",
        principal,
        body_sha256: Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))).toString("base64url"),
      });
    const connectToken = await sign({
      iss: "base44", aud: "base44-actor-connect", purpose: "actor-connect", v: 1,
      iat: now, nbf: now, exp: now + 300, jti: "connect-1",
      app_id: APP_ID, actor_name: "GameRoom", actor_script_id: SCRIPT_ID, room: "room-a",
      connection_id: "tab-1", runtime_mode: "prod",
      principal: { type: "anonymous", anonymousId: "browser-1" },
    });
    const post = (room: string, token: string, body: string) =>
      mf.dispatchFetch(`http://localhost/rooms/${room}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Base44-Actor-Request-Token": token },
        body,
      });
    const roomState = () => mf.dispatchFetch(`http://localhost/rooms/room-a?_pk=tab-1&token=${connectToken}`);
    return { mf, sign, now, requestToken, connectToken, post, roomState };
  }

  it("a request that wakes a room names it and runs handleStart first", async () => {
    const { mf, requestToken, post, roomState } = await actorWorker([
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor {",
      "  started = false;",
      "  handleStart() { this.started = true; }",
      "  async handleRequest() { await this.storage.put('seen', { room: this.name, started: this.started }); }",
      "  async fetch() { return Response.json((await this.storage.get('seen')) ?? null); }",
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleClose() {}",
      "}",
    ].join("\n"));
    try {
      const body = '{"type":"video_ready"}';
      expect((await post("room-a", await requestToken("room-a", body), body)).status).toBe(204);
      expect(await (await roomState()).json()).toEqual({ room: "room-a", started: true });
    } finally {
      await mf.dispose();
    }
  });

  it("hands handleRequest the token's identity and the body, and returns its response", async () => {
    const { mf, sign, now, requestToken, connectToken, post } = await actorWorker([
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor {",
      "  async handleRequest(request, { identity }) {",
      "    return Response.json({ identity, body: await request.json(), url: request.url }, { status: 201 });",
      "  }",
      "  fetch() { return new Response('room'); }",
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleClose() {}",
      "}",
    ].join("\n"));
    const body = '{"type":"video_ready","media_id":"video_1"}';
    try {
      const asService = await post("room-a", await requestToken("room-a", body), body);
      expect(asService.status).toBe(201);
      expect(await asService.json()).toEqual({
        identity: { type: "service" },
        body: { type: "video_ready", media_id: "video_1" },
        url: "https://actor.base44/rooms/room-a/requests",
      });
      const user = { type: "authenticated", userId: "user-1" };
      const asUser = await post("room-a", await requestToken("room-a", body, user), body);
      expect((await asUser.json()).identity).toEqual(user);

      const token = await requestToken("room-a", body);
      expect((await post("room-b", token, body)).status).toBe(403);
      // The token is bound to its body: a leaked token can't carry another one.
      expect((await post("room-a", token, '{"type":"other"}')).status).toBe(401);
      expect((await post("room-a", connectToken, body)).status).toBe(401);
      const asOwner = await requestToken("room-a", body, { type: "owner" });
      expect((await post("room-a", asOwner, body)).status).toBe(401);
      const preview = await sign({
        iss: "base44", aud: "base44-actor-request", purpose: "actor-request", v: 1,
        iat: now, nbf: now, exp: now + 60, jti: "jti-preview",
        app_id: APP_ID, actor_name: "GameRoom", actor_script_id: SCRIPT_ID, room: "room-a", runtime_mode: "preview",
        principal: { type: "service" },
        body_sha256: Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))).toString("base64url"),
      });
      expect((await post("room-a", preview, body)).status).toBe(403);
      const tooLarge = JSON.stringify({ pad: "x".repeat(64 * 1024) });
      expect((await post("room-a", await requestToken("room-a", tooLarge), tooLarge)).status).toBe(413);
      expect((await mf.dispatchFetch("http://localhost/rooms/room-a/requests")).status).toBe(404);
      // The Durable Object trusts the internal path and its identity header, so no
      // client route may reach it.
      const internalPath = await mf.dispatchFetch("http://localhost/parties/GameRoom/room-a/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Base44-Actor-Request-Token": token,
          "X-Base44-Actor-Identity": '{"type":"service"}',
        },
        body,
      });
      expect(internalPath.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it("an actor without handleRequest refuses requests, and a throw is a 500", async () => {
    const plain = await actorWorker([
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor {",
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleClose() {}",
      "}",
    ].join("\n"));
    const throwing = await actorWorker([
      'import { Actor } from "base44:runtime/actors";',
      "export default class GameRoom extends Actor {",
      "  handleRequest() { throw new Error('boom'); }",
      "  handleConnect() {}",
      "  handleMessage() {}",
      "  handleClose() {}",
      "}",
    ].join("\n"));
    const body = "{}";
    try {
      expect((await plain.post("room-a", await plain.requestToken("room-a", body), body)).status).toBe(404);
      expect((await throwing.post("room-a", await throwing.requestToken("room-a", body), body)).status).toBe(500);
    } finally {
      await plain.mf.dispose();
      await throwing.mf.dispose();
    }
  });
});
