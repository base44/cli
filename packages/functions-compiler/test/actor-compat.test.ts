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
});
