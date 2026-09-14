// @ts-nocheck — targets the CF Workers runtime, not Node; esbuild compiles it.
// Base class for Actors, injected into every deployed handler bundle.

import { Server, routePartykitRequest, type Connection, type ConnectionContext } from "partyserver";
import { createClient } from "npm:@base44/sdk@0.8.41";
import { TickLoop } from "./tick-loop";

export { routePartykitRequest };

export type ActorConnectionIdentity =
  | Readonly<{ type: "authenticated"; userId: string }>
  | Readonly<{ type: "anonymous"; anonymousId: string }>;

export interface Conn<Send = unknown> {
  /** Unique per-connection id (one per socket/tab). Identifies a distinct
   *  client, so multiple tabs are separate connections. */
  id: string;
  /** Identity verified by the generated Actor Worker before this room was
   *  resolved. Legacy proxied connections may not have one. */
  identity?: ActorConnectionIdentity;
  send(data: Send): void;
  reject(code: number, reason: string): void;
}

// Sentinel id for a superseded socket under the non-hibernating InMemory manager
// (its close deletes by id). The onClose skip keys off the attachment flag instead.
const SUPERSEDED_PREFIX = "__superseded__:";

function buildConn(ws: Connection, identity?: ActorConnectionIdentity): Conn {
  return {
    id: ws.id,   // partyserver's per-connection id (survives hibernation)
    ...(identity ? { identity } : {}),
    send(data: unknown) {
      ws.send(JSON.stringify(data));
    },
    reject(code: number, reason: string) {
      ws.close(code, reason);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class Actor<Incoming = unknown, Outgoing = unknown> extends Server<any> {
  // WebSocket Hibernation: idle rooms are evicted from memory (no duration
  // billing) with sockets kept open; onStart re-runs on wake to rehydrate. A
  // ticking room stays resident (its setTimeout loop blocks hibernation), so this
  // only affects non-ticking occupied rooms. Statics inherit, so a handler opts
  // out with `static options = { hibernate: false }`.
  static options = { hibernate: true };

  // conn.id is client-chosen and partyserver silently REPLACES a same-id socket
  // on accept, so a duplicate must be resolved before super.fetch(). Liveness
  // (SDK pings every 1s) distinguishes a real conflict from a reconnect.
  private lastSeen = new Map<string, number>();
  private identities = new Map<string, ActorConnectionIdentity | undefined>();
  private static readonly LIVE_MS = 3_000;
  private static readonly IDENTITY_HEADER = "X-Base44-Actor-Identity";

  // Captured at construction so `client` reads this DO's own env, not the shared
  // globalThis.Base44 bridge (which the last-constructed DO in the isolate wins).
  private _b44Env: Record<string, unknown>;
  private _b44Client: ReturnType<typeof createClient> | undefined;

  protected get client(): ReturnType<typeof createClient> {
    return (this._b44Client ??= new Proxy(
      createClient({
        appId: this._b44Env.BASE44_APP_ID as string,
        serverUrl: this._b44Env.BASE44_API_URL as string,
        // "prod" on the published script, "preview" on the draft — set at deploy.
        functionsVersion: this._b44Env.BASE44_FUNCTIONS_VERSION as string,
      }),
      {
        // The SDK bakes serviceToken into axios defaults at createClient time and
        // its own asServiceRole getter throws without one, so that one property is
        // answered by the lazy exchange below instead.
        get: (target, prop) =>
          prop === "asServiceRole"
            ? this._b44ServiceRolePath([])
            : Reflect.get(target, prop, target),
      },
    ));
  }

  // ── Service role ──────────────────────────────────────────────────────
  // The token is fetched on the first privileged call by trading an assertion
  // signed with the actor's private key, cached in memory, and re-fetched
  // after expiry. Hibernation wiping the cache just means the next call
  // exchanges again — nothing durable is stored.
  private _b44Service: { client: ReturnType<typeof createClient>; expiresAtMs: number } | null = null;
  private _b44ServicePending: Promise<ReturnType<typeof createClient>> | null = null;

  private async _b44SignServiceAssertion(privateKey: string, publicKey: string): Promise<string> {
    const b64url = (bin: string) =>
      btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const now = Math.floor(Date.now() / 1000);
    // Wire format pinned by backend/tests/unit/test_actor_service_token.py.
    const claims = {
      iss: "base44-actor",
      aud: "base44-actor-service-token",
      purpose: "actor-service-token",
      v: 1,
      iat: now,
      exp: now + 60,
      app_id: this._b44Env.BASE44_APP_ID,
      actor_name: (this.constructor as { _b44ActorName?: string })._b44ActorName,
    };
    const input = `${b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
    // The env values are the raw keys as unpadded base64url — exactly the JWK
    // d/x fields (WebCrypto refuses a raw import of an Ed25519 PRIVATE key).
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", d: privateKey, x: publicKey },
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(input)),
    );
    return `${input}.${b64url(String.fromCharCode(...signature))}`;
  }

  private async _b44FetchServiceClient(): Promise<ReturnType<typeof createClient>> {
    const privateKey = this._b44Env.BASE44_ACTOR_PRIVATE_KEY;
    const publicKey = this._b44Env.BASE44_ACTOR_PUBLIC_KEY;
    if (typeof privateKey !== "string" || !privateKey || typeof publicKey !== "string" || !publicKey) {
      throw new Error(
        "asServiceRole is unavailable on this actor: it predates direct connections. " +
          "Delete the actor and deploy it again (room storage is not preserved).",
      );
    }
    const response = await fetch(
      `${this._b44Env.BASE44_API_URL}/api/apps/${this._b44Env.BASE44_APP_ID}/actors/service-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertion: await this._b44SignServiceAssertion(privateKey, publicKey) }),
      },
    );
    if (!response.ok) {
      throw new Error(`Actor service token exchange failed (${response.status})`);
    }
    const { access_token, expires_in } = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    const client = createClient({
      appId: this._b44Env.BASE44_APP_ID as string,
      serverUrl: this._b44Env.BASE44_API_URL as string,
      functionsVersion: this._b44Env.BASE44_FUNCTIONS_VERSION as string,
      serviceToken: access_token,
    });
    // 60s skew so an in-flight call never presents a token expiring mid-request.
    this._b44Service = { client, expiresAtMs: Date.now() + (expires_in - 60) * 1000 };
    return client;
  }

  private _b44ServiceClient(): Promise<ReturnType<typeof createClient>> {
    if (this._b44Service && Date.now() < this._b44Service.expiresAtMs) {
      return Promise.resolve(this._b44Service.client);
    }
    // Single-flight: concurrent privileged calls share one exchange.
    return (this._b44ServicePending ??= this._b44FetchServiceClient().finally(() => {
      this._b44ServicePending = null;
    }));
  }

  // asServiceRole is a sync property chain ending in an async call, so proxies
  // record the chain and the exchange awaits inside the final call — actor code
  // reads identically to backend functions.
  private _b44ServiceRolePath(path: PropertyKey[]): unknown {
    const self = this;
    return new Proxy(function () {}, {
      get(_target, prop) {
        // Not thenable, or `await client.asServiceRole` would descend forever.
        if (typeof prop === "symbol" || prop === "then") return undefined;
        return self._b44ServiceRolePath([...path, prop]);
      },
      async apply(_target, _thisArg, args) {
        const serviceClient = await self._b44ServiceClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parent: any = serviceClient.asServiceRole;
        for (const prop of path.slice(0, -1)) parent = parent[prop];
        return parent[path[path.length - 1]](...args);
      },
    });
  }

  // Reserved platform keys — the private-data-sources manifest carries
  // plaintext VPC DB credentials. Keep in sync with worker-entry.ts.
  private static readonly RESERVED_SECRETS = new Set([
    "BASE44_ACTOR_PRIVATE_KEY",
    "BASE44_ACTOR_PUBLIC_KEY",
    "BASE44_ACTOR_SCRIPT_ID",
    "BASE44_PRIVATE_DATA_SOURCES",
  ]);

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this._b44Env = env;
    // base44:runtime's secrets.get()/waitUntil read the globalThis.Base44
    // bridge. Functions get it from the generated Worker entry per request; a
    // DO's env is fixed at construction, so install it once here — that covers
    // every wake path, including an alarm after eviction. Shape/filters stay
    // in sync with worker-entry.ts (its comment points back here).
    (globalThis as { Base44?: object }).Base44 = Object.assign(
      (globalThis as { Base44?: object }).Base44 ?? {},
      {
        // DOs have no request-scoped waitUntil (they stay alive while
        // connections exist) — absorb so shared function code doesn't crash.
        waitUntil: (p: Promise<unknown>) => {
          Promise.resolve(p).catch(() => {});
        },
        secrets: {
          // String(n) BEFORE the reserved check: a boxed String fails Set.has
          // yet coerces back to the reserved key on the env lookup.
          get: (n: unknown): string | undefined => {
            const key = String(n);
            if (Actor.RESERVED_SECRETS.has(key)) return undefined;
            const v = env[key];
            return typeof v === "string" ? v : undefined;
          },
        },
      },
    );
  }

  override async onStart(): Promise<void> {
    // Answer the SDK's 1s __ping at the edge so it can't keep a hibernatable room
    // resident. hibernate:false actors fall back to the onMessage ping branch.
    try {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair(
          JSON.stringify({ type: "__ping" }),
          JSON.stringify({ type: "__pong" }),
        ),
      );
    } catch {
      // Runtime without the API — pings fall through to onMessage.
    }
    await this.handleStart();
    await this.maintainTicker();   // pings no longer drive loop self-heal; re-check on wake
  }

  private livenessMs(ws: Connection): number {
    let autoResp = 0;
    try {
      autoResp = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
    } catch {
      // Runtime without the API — rely on lastSeen (its onMessage __ping fallback fires).
    }
    return Math.max(this.lastSeen.get(ws.id) ?? 0, autoResp);
  }

  private static parseIdentity(value: string | null): ActorConnectionIdentity | undefined {
    if (!value || value.length > 512) return undefined;
    try {
      const identity = JSON.parse(value) as Record<string, unknown>;
      if (
        identity.type === "authenticated" &&
        typeof identity.userId === "string" &&
        identity.userId.length > 0 &&
        identity.userId.length <= 128
      ) {
        return Object.freeze({ type: "authenticated", userId: identity.userId });
      }
      if (
        identity.type === "anonymous" &&
        typeof identity.anonymousId === "string" &&
        identity.anonymousId.length > 0 &&
        identity.anonymousId.length <= 128
      ) {
        return Object.freeze({ type: "anonymous", anonymousId: identity.anonymousId });
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private identityFor(ws: Connection): ActorConnectionIdentity | undefined {
    if (this.identities.has(ws.id)) return this.identities.get(ws.id);
    let identity: ActorConnectionIdentity | undefined;
    try {
      identity = (
        ws.deserializeAttachment() as { __base44Identity?: ActorConnectionIdentity } | null
      )?.__base44Identity;
      if (identity) Object.freeze(identity);
    } catch { /* hibernate:false connections have no attachment API */ }
    this.identities.set(ws.id, identity);
    return identity;
  }

  // partyserver's fetch() catch re-throws "Network connection lost." when the
  // client already went away; swallow it so it isn't logged as an exception.
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pk = new URL(request.url).searchParams.get("_pk");
      if (pk) {
        const existing = [...super.getConnections()].find((c) => c.id === pk);
        if (existing !== undefined && Date.now() - this.livenessMs(existing) < Actor.LIVE_MS) {
          return new Response("Connection id already in use", { status: 409 });
        }
        // Reconnect of a stale holder. Flag it via the attachment (NOT the id:
        // under hibernation the id is a getter-only property, so assigning throws)
        // so onClose skips it. The best-effort id-rename still covers the InMemory
        // manager, whose close deletes by id and would evict the new same-id socket.
        if (existing !== undefined) {
          try {
            const att = (existing.deserializeAttachment() as Record<string, unknown> | null) ?? {};
            existing.serializeAttachment({ ...att, __superseded: true });
          } catch { /* in-memory socket (hibernate:false): no attachment API — the id-rename below is its marker */ }
          try { (existing as { id: string }).id = `${SUPERSEDED_PREFIX}${pk}`; } catch { /* hibernating: getter-only id */ }
          try { existing.close(4408, "Superseded by reconnect"); } catch { /* already gone */ }
        }
      }
    }
    try {
      return await super.fetch(request);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Network connection lost")) {
        return new Response("Connection lost", { status: 503 });
      }
      throw err;
    }
  }

  override async onConnect(
    ws: Connection,
    ctx: ConnectionContext,
  ): Promise<void> {
    const identity = Actor.parseIdentity(
      ctx.request.headers.get(Actor.IDENTITY_HEADER),
    );
    this.identities.set(ws.id, identity);
    if (identity) {
      try {
        const attachment = (
          ws.deserializeAttachment() as Record<string, unknown> | null
        ) ?? {};
        ws.serializeAttachment({ ...attachment, __base44Identity: identity });
      } catch {
        // hibernate:false connections keep identity in the in-memory map.
      }
    }
    this.lastSeen.set(ws.id, Date.now());
    await this.handleConnect(buildConn(ws, identity));
    await this.maintainTicker();
  }

  override async onMessage(ws: Connection, raw: string): Promise<void> {
    this.lastSeen.set(ws.id, Date.now());   // any inbound traffic proves liveness
    let msg: Message;
    try {
      msg = JSON.parse(raw) as Message;
    } catch {
      return;
    }
    // Ping fallback for hibernate:false actors (hibernation-accepted sockets are
    // answered at the edge by onStart's auto-response and never reach here).
    if ((msg as { type?: unknown })?.type === "__ping") {
      ws.send(JSON.stringify({ type: "__pong" }));
      await this.maintainTicker();   // restart a dead in-memory loop fast
      return;
    }
    await this.handleMessage(buildConn(ws, this.identityFor(ws)), msg);
    await this.maintainTicker();     // re-evaluate: the message may have changed shouldTick()
  }

  override async onClose(ws: Connection): Promise<void> {
    // Superseded by its own reconnect → close silently. Hibernated sockets carry
    // the flag on the attachment; the in-memory manager (hibernate:false) has no
    // attachment API (deserializeAttachment throws) and keeps the id-rename marker.
    let superseded = ws.id.startsWith(SUPERSEDED_PREFIX);
    if (!superseded) {
      try {
        superseded = !!(ws.deserializeAttachment() as { __superseded?: boolean } | null)?.__superseded;
      } catch { /* in-memory socket: no attachment API */ }
    }
    if (superseded) return;
    const identity = this.identityFor(ws);
    this.lastSeen.delete(ws.id);     // a clean close frees the id for instant reuse
    this.identities.delete(ws.id);
    await this.handleClose(buildConn(ws, identity));
    await this.maintainTicker();     // a disconnect may drop below shouldTick() → stop
  }

  // WATCHDOG, not the metronome (see tick-loop.ts): resumes the loop after
  // eviction / self-heals a dead one. Never runs handleTick itself.
  override async onAlarm(): Promise<void> {
    // A start/stop transition during any await below owns the loop state; a
    // stale alarm resuming must not restore a loop the transition just stopped.
    const gen = this.tickerGen;
    // Fire due scheduled wakes first (delete-then-dispatch: a throw in user
    // code must not replay the wake forever via alarm retries).
    const now = Date.now();
    const due = await this.mutateSchedules((m) => {
      const d = Object.keys(m).filter((k) => m[k] <= now);
      for (const k of d) delete m[k];
      return d;
    });
    for (const key of due) {
      try {
        await this.handleWake(key);
      } catch (err) {
        console.error("Actor.handleWake threw:", err);
      }
    }
    const ms = this.loopMs ?? (await this.ctx.storage.get<number>("__loop_ms"));
    if (gen !== this.tickerGen) return; // the transition already rearmed
    if (ms) {
      this.loopMs = ms;
      if (typeof this.shouldTick === "function"
          && !([...super.getConnections()].length > 0 && this.shouldTick())) {
        this.ticking = false;
        await this.stopLoop();
        return;
      }
      if (!this.loop.isRunning) this.loop.start(ms);
    }
    await this.rearmAlarm();
  }

  protected handleWake(_key: string): void | Promise<void> {}

  protected async schedule(key: string, at: number | Date): Promise<void> {
    const when = typeof at === "number" ? at : at.getTime();
    await this.mutateSchedules((m) => {
      m[key] = when;
    });
    await this.rearmAlarm();
  }

  protected async cancelSchedule(key: string): Promise<void> {
    await this.mutateSchedules((m) => {
      delete m[key];
    });
    await this.rearmAlarm();
  }

  // Concurrent read-modify-writes of the map would drop each other's keys
  // (two schedule() calls both reading the prior map); chain them instead.
  private schedulesChain: Promise<unknown> = Promise.resolve();

  private mutateSchedules<T>(fn: (m: Record<string, number>) => T): Promise<T> {
    const run = this.schedulesChain.then(async () => {
      const m = (await this.ctx.storage.get<Record<string, number>>("__schedules")) ?? {};
      const out = fn(m);
      await this.ctx.storage.put("__schedules", m);
      return out;
    });
    this.schedulesChain = run.catch(() => {});
    return run;
  }

  // The single DO alarm serves the ticker watchdog AND scheduled wakes: arm to
  // whichever is earliest; clear only when neither needs it. Chained on the
  // schedules queue so a rearm that read the map before a queued mutation can
  // never act after that mutation's own rearm and clobber it.
  private rearmAlarm(): Promise<void> {
    const run = this.schedulesChain.then(async () => {
      const wakes = Object.values(
        (await this.ctx.storage.get<Record<string, number>>("__schedules")) ?? {},
      );
      const nextWake = wakes.length ? Math.min(...wakes) : null;
      const watchdog = this.loop.isRunning ? Date.now() + Actor.WATCHDOG_MS : null;
      const next = nextWake === null ? watchdog : watchdog === null ? nextWake : Math.min(nextWake, watchdog);
      if (next === null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(next);
    });
    this.schedulesChain = run.catch(() => {});
    return run;
  }

  abstract handleConnect(conn: Conn<Outgoing>): void | Promise<void>;
  abstract handleMessage(conn: Conn<Outgoing>, msg: Incoming): void | Promise<void>;
  abstract handleTick(): void | Promise<void>;
  abstract handleClose(conn: Conn<Outgoing>): void | Promise<void>;
  // Optional wake hook: once per instance start, before any connection.
  protected handleStart(): void | Promise<void> {}

  // ─── Managed ticker (opt-in) ──────────────────────────────────────────────
  // Override shouldTick() and the platform runs handleTick() on a timer while it
  // returns true, stopping (the DO can idle out) when false. shouldTick()
  // must be cheap and pure: it runs after every lifecycle event and tick.
  protected tickIntervalMs = 100;
  protected shouldTick?(): boolean;
  private ticking = false;
  private loopMs: number | null = null;   // in-memory mirror of __loop_ms
  private readonly loop = new TickLoop(() => this.runOneTick());
  private static readonly WATCHDOG_MS = 30_000;

  // One tick: a throw skips the tick, never kills the loop.
  private async runOneTick(): Promise<boolean> {
    const gen = this.tickerGen;
    try {
      await this.handleTick();
    } catch (err) {
      console.error("Actor.handleTick threw:", err);
    }
    // A transition DURING the tick (user deleteAll → stopLoop, a restart) owns
    // the state — this stale run must not write `ticking` back or double-stop.
    if (gen !== this.tickerGen) return false;
    if (typeof this.shouldTick === "function") {
      // Empty rooms force-stop regardless of the predicate ("keep warm"
      // always-true predicates burn duration for an audience of zero).
      const keep = [...super.getConnections()].length > 0 && this.shouldTick();
      this.ticking = keep;
      if (!keep) {
        await this.stopLoop();
        return false;
      }
      return true;
    }
    return this.loopMs != null;
  }

  protected broadcast(data: Outgoing): void {
    super.broadcast(JSON.stringify(data));
  }

  protected getConnections(): Conn<Outgoing>[] {
    return [...super.getConnections()].map((ws) => buildConn(ws, this.identityFor(ws)));
  }

  // The newest start/stop owns the persisted state: a stale transition
  // resuming after its await must not erase a fresh __loop_ms/watchdog.
  private tickerGen = 0;

  private async startLoop(ms: number): Promise<void> {
    const gen = ++this.tickerGen;
    this.loopMs = ms;
    // Persisted so the watchdog can resume the loop after eviction.
    await this.ctx.storage.put("__loop_ms", ms);
    if (gen !== this.tickerGen) return;
    this.loop.start(ms);
    await this.rearmAlarm();
  }

  private async stopLoop(): Promise<void> {
    const gen = ++this.tickerGen;
    this.loop.stop();
    this.loopMs = null;
    // Keep the managed-ticker mirror honest: a stop not routed through
    // maintainTicker (storage.deleteAll) must not leave `ticking` stuck true,
    // or maintainTicker sees want===ticking and never restarts the loop.
    this.ticking = false;
    await this.ctx.storage.delete("__loop_ms");
    if (gen !== this.tickerGen) return;
    await this.rearmAlarm();   // keeps the alarm armed for any scheduled wakes
  }

  // Restart a dead in-memory loop (eviction / isolate reload).
  private async ensureLoop(): Promise<void> {
    if (this.loopMs == null) {
      const gen = this.tickerGen;
      const ms = await this.ctx.storage.get<number>("__loop_ms");
      // A start/stop transition during the read owns the state — a stale
      // read must not resurrect a loop an explicit stop just tore down.
      if (gen !== this.tickerGen) return;
      if (!ms) return; // loop not started, or intentionally stopped
      this.loopMs = ms;
    }
    if (!this.loop.isRunning) this.loop.start(this.loopMs);
  }

  // Managed-ticker reconcile: run after every lifecycle event. The ticker is
  // opt-in via shouldTick() — a handler that doesn't define it never ticks.
  // When opted in, start/stop the loop to match, self-healing a dead loop
  // while still wanted.
  private async maintainTicker(): Promise<void> {
    if (typeof this.shouldTick !== "function") return;
    const want = [...super.getConnections()].length > 0 && this.shouldTick();
    if (want !== this.ticking) {
      this.ticking = want;
      if (want) await this.startLoop(this.tickIntervalMs);
      else await this.stopLoop();
    } else if (want) {
      await this.ensureLoop();   // still ticking → restart if the loop died
    }
  }

  protected get instanceId(): string {
    return this.name;
  }

  protected get storage() {
    const store = this.ctx.storage;
    return {
      get: <T>(key: string): Promise<T | undefined> => store.get<T>(key),
      put: (key: string, value: unknown): Promise<void> => store.put(key, value),
      delete: (key: string): Promise<boolean> => store.delete(key),
      deleteAll: async (): Promise<void> => {
        // The wiped __loop_ms could never resume a running loop post-eviction —
        // stop it; managed rooms restart via shouldTick().
        await this.stopLoop();
        await store.deleteAll();
      },
    };
  }

}
