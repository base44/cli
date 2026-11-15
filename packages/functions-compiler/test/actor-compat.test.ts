import { describe, expect, it } from "vitest";

import { applyActorCompat } from "../src/actor-compat";
import { STATIC_EGRESS_ARTIFACT_MARKER } from "../src/static-egress";
import { SHIM_FILENAME } from "../src/worker-entry";

const ACTOR_ENTRY_FILENAME = "__base44_actor_entry.mjs";
const ACTOR_PRELUDE_FILENAME = "__base44_actor_prelude.mjs";
const ACTOR_AUTH_FILENAME = "__base44_actor_auth.mjs";
const STANDARD_ENTRY_FILENAME = "__base44_entry.mjs";
const ACTOR_HANDLER =
  "export default class extends Actor { handleConnect(){} handleMessage(){} handleTick(){} handleClose(){} }";

async function makeActorKeypair(): Promise<{ privateKey: CryptoKey; publicKeyB64url: string }> {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  return { privateKey, publicKeyB64url: Buffer.from(raw).toString("base64url") };
}

async function signToken(
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "EdDSA", typ: "JWT" });
  const payload = encode(claims);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

describe("applyActorCompat", () => {
  it("an EMPTY canonical entry is still an actor (never a plain Worker)", () => {
    const out = applyActorCompat("base44/actors/Room/entry.ts", {
      "base44/actors/Room/entry.ts": "",
    });
    expect(out).not.toBeNull();
    expect(out!.handlerName).toBe("Room");
  });

  it("a canonical actors path IS an actor: wrapper re-exports the default under the FOLDER name", () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const source = `import { Actor } from "base44:runtime/actors";\n${ACTOR_HANDLER}`;

    const result = applyActorCompat(entry, { [entry]: source });
    expect(result).not.toBeNull();
    // The user source stays untouched while the generated wrapper receives the
    // same request-scoped runtime as ordinary functions.
    expect(result!.files[entry]).toBe(source);
    expect(result!.files[SHIM_FILENAME]).toContain(
      STATIC_EGRESS_ARTIFACT_MARKER,
    );
    // The generated DO wrapper is added under the reserved entry name.
    expect(result!.entry).toBe(ACTOR_ENTRY_FILENAME);
    const prelude = result!.files[ACTOR_PRELUDE_FILENAME];
    expect(prelude).toContain("installStaticEgressFetch()");
    const wrapper = result!.files[ACTOR_ENTRY_FILENAME];
    expect(wrapper).toContain(`import Base44UserActor from "./${entry}"`);
    expect(
      wrapper.indexOf(`import "./${ACTOR_PRELUDE_FILENAME}"`),
    ).toBeLessThan(wrapper.indexOf(`import Base44UserActor from "./${entry}"`));
    expect(wrapper).toContain("runWithWorkerEnvironment as _b44Run");
    expect(wrapper).not.toContain("base44.workerEnvironment");
    expect(wrapper).toContain("export class GameRoom extends Base44UserActor");
    expect(wrapper).toContain("Reflect.construct(Base44UserActor, [ctx, env], newTarget)");
    expect(wrapper).toContain(
      "_b44RunActor(this, null, () => super.onStart(...args))",
    );
    expect(wrapper).toContain(
      "_b44RunActor(this, null, () => super.onError(...args))",
    );
    expect(result!.handlerName).toBe("GameRoom");
    expect(result!.doClassName).toBe("GameRoom");

    const auth = result!.files[ACTOR_AUTH_FILENAME];
    expect(auth).toContain('header?.alg !== "EdDSA"');
    expect(auth).toContain('claims.aud !== "base44-actor-connect"');
    expect(auth).toContain("claims.actor_script_id !== scriptId");
    expect(auth).toContain("claims.connection_id !== new URL(request.url).searchParams.get(\"_pk\")");
    expect(wrapper.indexOf("_b44VerifyActorConnection"))
      .toBeLessThan(wrapper.indexOf("idFromName(room)"));
  });

  it("the user's class name is cosmetic — an anonymous default export names from the folder", () => {
    const entry = "base44/actors/Lobby/entry.ts";
    const source = `import { Actor } from "base44:runtime/actors";\nexport default class MyWeirdName extends Actor {}`;
    const result = applyActorCompat(entry, { [entry]: source });
    expect(result).not.toBeNull();
    expect(result!.handlerName).toBe("Lobby");
  });

  it("a non-actors path is never an actor, whatever its source says", () => {
    const entry = "base44/functions/api/entry.ts";
    const source = `import { Actor } from "base44:runtime/actors";\n${ACTOR_HANDLER}`;
    expect(applyActorCompat(entry, { [entry]: source })).toBeNull();
  });

  it("a non-canonical entry under actors/ is not detected (helpers are not entries)", () => {
    const entry = "base44/actors/GameRoom/lib/entry.ts";
    expect(applyActorCompat(entry, { [entry]: ACTOR_HANDLER })).toBeNull();
  });

  it("rejects a user file colliding with the generated wrapper filename", () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const files = {
      [entry]: ACTOR_HANDLER,
      [ACTOR_ENTRY_FILENAME]: "user file",
    };
    expect(() => applyActorCompat(entry, files)).toThrow(/reserved filename/i);
  });
  it("rejects a trusted standard-entry filename in an actor bundle", () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const files = {
      [entry]: ACTOR_HANDLER,
      [STANDARD_ENTRY_FILENAME]:
        'export { workerEnvironment } from "base44:internal/runtime-context";',
    };

    expect(() => applyActorCompat(entry, files)).toThrow(/reserved filename/i);
  });

  it("rejects a user file colliding with the generated prelude filename", () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const files = {
      [entry]: ACTOR_HANDLER,
      [ACTOR_PRELUDE_FILENAME]: "user file",
    };

    expect(() => applyActorCompat(entry, files)).toThrow(/reserved filename/i);
  });

  it("rejects a user file colliding with the generated Actor auth filename", () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const files = {
      [entry]: ACTOR_HANDLER,
      [ACTOR_AUTH_FILENAME]: "user file",
    };

    expect(() => applyActorCompat(entry, files)).toThrow(/reserved filename/i);
  });

  it("validates every route-bound claim before producing the trusted Actor request", async () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const result = applyActorCompat(entry, { [entry]: ACTOR_HANDLER })!;
    const authSource = result.files[ACTOR_AUTH_FILENAME];
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(authSource).toString("base64")}`;
    const auth = await import(/* @vite-ignore */ moduleUrl);
    const now = Math.floor(Date.now() / 1_000);
    const scriptId = "actor-p-0123456789abcdef01234567-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { privateKey, publicKeyB64url } = await makeActorKeypair();
    const token = await signToken({
      iss: "base44",
      aud: "base44-actor-connect",
      purpose: "actor-connect",
      v: 1,
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: "token-1",
      app_id: "0123456789abcdef01234567",
      actor_name: "GameRoom",
      actor_script_id: scriptId,
      room: "room-1",
      connection_id: "tab-1",
      runtime_mode: "prod",
      principal: { type: "anonymous", anonymousId: "browser-1" },
    }, privateKey);
    const request = new Request(
      `https://worker.example/rooms/room-1?_pk=tab-1&token=${token}`,
    );
    const env = {
      BASE44_ACTOR_PUBLIC_KEY: publicKeyB64url,
      BASE44_ACTOR_SCRIPT_ID: scriptId,
      BASE44_APP_ID: "0123456789abcdef01234567",
      BASE44_FUNCTIONS_VERSION: "prod",
    };

    const valid = await auth.verifyActorConnection(request, env, "GameRoom", "room-1");
    const wrongRoom = await auth.verifyActorConnection(request, env, "GameRoom", "room-2");
    expect(valid).toMatchObject({
      ok: true,
      identity: { type: "anonymous", anonymousId: "browser-1" },
      runtimeMode: "prod",
    });
    expect(wrongRoom).toMatchObject({ ok: false, response: { status: 401 } });

    const trusted = auth.authorizedActorRequest(
      request,
      valid.identity,
      "GameRoom",
      "room-1",
      valid.runtimeMode,
    );
    expect(new URL(trusted.url).pathname).toBe("/parties/GameRoom/room-1");
    expect(new URL(trusted.url).searchParams.has("token")).toBe(false);
    expect(trusted.headers.get("X-Base44-Actor-Token")).toBeNull();
    expect(JSON.parse(trusted.headers.get("X-Base44-Actor-Identity")!)).toEqual(
      valid.identity,
    );
  });

  it("routes a relayed call past the user's fetch override into the room", () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const wrapper = applyActorCompat(entry, { [entry]: ACTOR_HANDLER })!.files[ACTOR_ENTRY_FILENAME];
    expect(wrapper).toContain(
      'request.method === "POST" && parts[1] === "rooms" && parts.length === 4 && parts[3] === "requests"',
    );
    expect(wrapper).toContain("this._b44ActorCall(request)");
    expect(wrapper.indexOf("_b44VerifyActorRequest(request"))
      .toBeLessThan(wrapper.indexOf("_b44ActorRequestToRoom(request"));
  });

  it("accepts only a request token minted for this app, actor, script, room, runtime and body", async () => {
    const entry = "base44/actors/GameRoom/entry.ts";
    const result = applyActorCompat(entry, { [entry]: ACTOR_HANDLER })!;
    const authSource = result.files[ACTOR_AUTH_FILENAME];
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(authSource).toString("base64")}`;
    const auth = await import(/* @vite-ignore */ moduleUrl);
    const now = Math.floor(Date.now() / 1_000);
    const scriptId = "actor-p-0123456789abcdef01234567-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { privateKey, publicKeyB64url } = await makeActorKeypair();
    const env = {
      BASE44_ACTOR_PUBLIC_KEY: publicKeyB64url,
      BASE44_ACTOR_SCRIPT_ID: scriptId,
      BASE44_APP_ID: "0123456789abcdef01234567",
      BASE44_FUNCTIONS_VERSION: "prod",
    };
    const body = '{"type":"video_ready"}';
    const bodySha = async (text: string) =>
      Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("base64url");
    const claims = {
      iss: "base44",
      aud: "base44-actor-request",
      purpose: "actor-request",
      v: 1,
      iat: now,
      nbf: now,
      exp: now + 60,
      jti: "request-token-1",
      app_id: env.BASE44_APP_ID,
      actor_name: "GameRoom",
      actor_script_id: scriptId,
      room: "room-1",
      runtime_mode: "prod",
      principal: { type: "service" },
      body_sha256: await bodySha(body),
      caller_token_sha256: null as string | null,
    };
    const post = (token: string, text = body, callerAuthorization?: string) =>
      new Request("https://worker.example/rooms/room-1/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Base44-Actor-Request-Token": token,
          ...(callerAuthorization ? { "X-Base44-Actor-Caller-Authorization": callerAuthorization } : {}),
        },
        body: text,
      });
    const requestToken = await signToken(claims, privateKey);

    const valid = await auth.verifyActorRequest(post(requestToken), env, "GameRoom", "room-1");
    expect(valid).toMatchObject({ ok: true, identity: { type: "service" }, runtimeMode: "prod" });
    expect(new TextDecoder().decode(valid.body)).toBe(body);
    expect(await auth.verifyActorRequest(post(requestToken), env, "GameRoom", "room-2"))
      .toMatchObject({ ok: false, response: { status: 403 } });
    expect(await auth.verifyActorRequest(post(requestToken), env, "Lobby", "room-1"))
      .toMatchObject({ ok: false, response: { status: 403 } });
    expect(await auth.verifyActorRequest(post(requestToken, '{"type":"other"}'), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });

    // Same key, other purpose: neither token stands in for the other.
    const asConnectToken = await signToken(
      { ...claims, aud: "base44-actor-connect", purpose: "actor-connect", exp: now + 300 },
      privateKey,
    );
    expect(await auth.verifyActorRequest(post(asConnectToken), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });
    const connectRequest = new Request(`https://worker.example/rooms/room-1?_pk=tab-1&token=${requestToken}`);
    expect(await auth.verifyActorConnection(connectRequest, env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });
    // The 0.3.0 platform-event purpose is retired.
    const asEventToken = await signToken(
      { ...claims, aud: "base44-actor-event", purpose: "actor-platform-event", event_id: "video_1:completed" },
      privateKey,
    );
    expect(await auth.verifyActorRequest(post(asEventToken), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });

    const longLived = await signToken({ ...claims, exp: now + 61 }, privateKey);
    expect(await auth.verifyActorRequest(post(longLived), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });
    const servicePlus = await signToken({ ...claims, principal: { type: "service", userId: "u" } }, privateKey);
    expect(await auth.verifyActorRequest(post(servicePlus), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });

    const withCaller = await signToken({ ...claims, caller_token_sha256: await bodySha("Bearer user-tok") }, privateKey);
    const verifiedCaller = await auth.verifyActorRequest(post(withCaller, body, "Bearer user-tok"), env, "GameRoom", "room-1");
    expect(verifiedCaller).toMatchObject({ ok: true, callerAuthorization: "Bearer user-tok" });
    expect(await auth.verifyActorRequest(post(withCaller, body, "Bearer other"), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });
    expect(await auth.verifyActorRequest(post(withCaller), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });
    expect(await auth.verifyActorRequest(post(requestToken, body, "Bearer added"), env, "GameRoom", "room-1"))
      .toMatchObject({ ok: false, response: { status: 401 } });
    const callerForwarded = auth.actorRequestToRoom(post(withCaller, body, "Bearer user-tok"), "GameRoom", "room-1", verifiedCaller);
    expect(callerForwarded.headers.get("X-Base44-Actor-Caller-Authorization")).toBe("Bearer user-tok");

    const forwarded = auth.actorRequestToRoom(post(requestToken), "GameRoom", "room-1", valid);
    expect(forwarded.method).toBe("POST");
    expect(new URL(forwarded.url).pathname).toBe("/parties/GameRoom/room-1/requests");
    expect(forwarded.headers.get("X-Base44-Actor-Request-Token")).toBeNull();
    expect(forwarded.headers.get("X-Base44-Actor-Identity")).toBe('{"type":"service"}');
    expect(forwarded.headers.get("X-Base44-Actor-Caller-Authorization")).toBeNull();
    expect(forwarded.headers.get("base44-functions-version")).toBe("prod");
    expect(await forwarded.text()).toBe(body);
  });
});
