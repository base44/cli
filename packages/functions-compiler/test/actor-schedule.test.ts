// Scheduled-wake contract of the Actor shim: schedule/cancelSchedule persist,
// onAlarm delete-then-dispatches due wakes, and the single alarm slot is armed
// to the earliest of (next wake, ticker watchdog).
import { describe, expect, it, vi } from "vitest";

vi.mock("partyserver", () => ({
  Server: class {
    ctx: unknown;
    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
    getConnections() {
      return (this as { __conns?: unknown[] }).__conns ?? [];
    }
    broadcast() {}
    async fetch() { return new Response("ok"); }
  },
  routePartykitRequest: () => undefined,
}));

const { Actor } = await import("../src/shim/actor");

function fakeStorage() {
  const map = new Map<string, unknown>();
  const state = { alarm: null as number | null };
  return {
    state,
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
    delete: async (k: string) => map.delete(k),
    deleteAll: async () => void map.clear(),
    setAlarm: async (t: number) => void (state.alarm = t),
    deleteAlarm: async () => void (state.alarm = null),
  };
}

class Room extends Actor {
  woke: string[] = [];
  handleConnect() {}
  handleMessage() {}
  handleTick() {}
  handleClose() {}
  override async handleWake(key: string) {
    if (key === "boom") throw new Error("boom");
    this.woke.push(key);
  }
}

function makeRoom() {
  const storage = fakeStorage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const room = new Room({ storage } as any, {}) as any;
  return { room, storage };
}

describe("Actor base44:runtime bridge", () => {
  it("installs secrets from the DO env; reserved keys and non-strings hidden", () => {
    const storage = fakeStorage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Room({ storage } as any, {
      MY_KEY: "s3cret",
      BASE44_ACTOR_PRIVATE_KEY: "private-key",
      BASE44_ACTOR_PUBLIC_KEY: "public-key",
      BASE44_ACTOR_SCRIPT_ID: "actor-script",
      BASE44_PRIVATE_DATA_SOURCES: "manifest",
      SOME_BINDING: { hyperdrive: true },
    });
    const bridge = (globalThis as { Base44?: { secrets: { get(n: unknown): string | undefined } } }).Base44!;
    expect(bridge.secrets.get("MY_KEY")).toBe("s3cret");
    expect(bridge.secrets.get("BASE44_ACTOR_PRIVATE_KEY")).toBeUndefined();
    expect(bridge.secrets.get("BASE44_ACTOR_PUBLIC_KEY")).toBeUndefined();
    expect(bridge.secrets.get("BASE44_ACTOR_SCRIPT_ID")).toBeUndefined();
    expect(bridge.secrets.get("BASE44_PRIVATE_DATA_SOURCES")).toBeUndefined();
    expect(bridge.secrets.get("SOME_BINDING")).toBeUndefined();
    // boxed-String coercion must not leak the reserved manifest
    expect(bridge.secrets.get(new String("BASE44_PRIVATE_DATA_SOURCES"))).toBeUndefined();
  });
});

describe("Actor verified connection identity", () => {
  it("exposes identity for every lifecycle event and restores it from a hibernation attachment", async () => {
    const storage = fakeStorage();
    const seen: unknown[] = [];
    class IdentityRoom extends Actor {
      handleConnect(conn: unknown) { seen.push(conn); }
      handleMessage(conn: unknown) { seen.push(conn); }
      handleTick() {}
      handleClose(conn: unknown) { seen.push(conn); }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const room = new IdentityRoom({ storage } as any, {}) as any;
    let attachment: unknown = null;
    const deserializeAttachment = vi.fn(() => structuredClone(attachment));
    const ws = {
      id: "tab-1",
      send: vi.fn(),
      close: vi.fn(),
      deserializeAttachment,
      serializeAttachment: (value: unknown) => { attachment = value; },
    };
    room.__conns = [ws];
    const identity = { type: "authenticated", userId: "user-1" };
    await room.onConnect(ws, {
      request: new Request("https://do/parties/IdentityRoom/room-1?_pk=tab-1", {
        headers: { "X-Base44-Actor-Identity": JSON.stringify(identity) },
      }),
    });
    room.identities.clear();
    deserializeAttachment.mockClear();
    await room.onMessage(ws, JSON.stringify({ type: "event" }));
    await room.onMessage(ws, JSON.stringify({ type: "event" }));
    const [restoredConnection] = room.getConnections();

    expect(deserializeAttachment).toHaveBeenCalledOnce();
    await room.onClose(ws);

    expect(seen.map((conn: any) => conn.identity)).toEqual([
      identity,
      identity,
      identity,
      identity,
    ]);
    expect(Object.isFrozen((seen[0] as any).identity)).toBe(true);
    const restoredIdentity = (seen[1] as any).identity;
    expect(Object.isFrozen(restoredIdentity)).toBe(true);
    expect((seen[2] as any).identity).toBe(restoredIdentity);
    expect(restoredConnection.identity).toBe(restoredIdentity);
    expect((seen[3] as any).identity).toBe(restoredIdentity);
  });

  it("memoizes a missing identity after hibernation", async () => {
    const storage = fakeStorage();
    const seen: unknown[] = [];
    class IdentityRoom extends Actor {
      handleConnect() {}
      handleMessage(conn: unknown) { seen.push(conn); }
      handleTick() {}
      handleClose() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const room = new IdentityRoom({ storage } as any, {}) as any;
    const deserializeAttachment = vi.fn(() => null);
    const ws = {
      id: "legacy-tab",
      send: vi.fn(),
      close: vi.fn(),
      deserializeAttachment,
    };
    room.__conns = [ws];

    await room.onMessage(ws, JSON.stringify({ type: "first" }));
    await room.onMessage(ws, JSON.stringify({ type: "second" }));
    const [connection] = room.getConnections();

    expect(deserializeAttachment).toHaveBeenCalledOnce();
    expect(seen.map((conn: any) => conn.identity)).toEqual([undefined, undefined]);
    expect(connection.identity).toBeUndefined();
  });
});

describe("Actor supersede on reconnect (hibernate:false / no attachment API)", () => {
  it("supersedes a stale same-id socket without throwing when the attachment API is absent", async () => {
    const storage = fakeStorage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const room = new Room({ storage } as any, {}) as any;
    // In-memory (hibernate:false) socket: the attachment API throws.
    const stale = {
      id: "tab-1",
      deserializeAttachment: () => { throw new Error("no attachment API"); },
      serializeAttachment: () => { throw new Error("no attachment API"); },
      close: vi.fn(),
    };
    room.__conns = [stale];
    const req = {
      url: "https://do/parties/Room/room-1?_pk=tab-1",
      headers: { get: (h: string) => (h === "Upgrade" ? "websocket" : null) },
    };
    // Must NOT throw (the attachment write is guarded); the id-rename + close
    // fallback still marks the superseded socket for the in-memory manager.
    await expect(room.fetch(req)).resolves.toBeDefined();
    expect(stale.close).toHaveBeenCalledWith(4408, "Superseded by reconnect");
    expect(stale.id).toBe("__superseded__:tab-1");
  });
});

describe("Actor scheduled wakes", () => {
  it("schedule arms the alarm; onAlarm dispatches due keys once and disarms", async () => {
    const { room, storage } = makeRoom();
    const at = Date.now() - 1; // already due
    await room.schedule("start", at);
    expect(storage.state.alarm).toBe(at);

    await room.onAlarm();
    expect(room.woke).toEqual(["start"]);
    expect(await storage.get("__schedules")).toEqual({});
    expect(storage.state.alarm).toBeNull(); // nothing left to wake, no loop

    await room.onAlarm(); // alarm retry must not replay the wake
    expect(room.woke).toEqual(["start"]);
  });

  it("a throwing handleWake still consumes its key and fires siblings", async () => {
    const { room, storage } = makeRoom();
    await room.schedule("boom", Date.now() - 2);
    await room.schedule("ok", Date.now() - 1);

    await room.onAlarm();
    expect(room.woke).toEqual(["ok"]);
    expect(await storage.get("__schedules")).toEqual({});
  });

  it("future wakes stay persisted and keep the alarm armed", async () => {
    const { room, storage } = makeRoom();
    const due = Date.now() - 1;
    const later = Date.now() + 60_000;
    await room.schedule("now", due);
    await room.schedule("later", later);

    await room.onAlarm();
    expect(room.woke).toEqual(["now"]);
    expect(await storage.get("__schedules")).toEqual({ later });
    expect(storage.state.alarm).toBe(later);
  });

  it("concurrent schedule calls both persist (no read-modify-write loss)", async () => {
    const { room, storage } = makeRoom();
    const t1 = Date.now() + 10_000;
    const t2 = Date.now() + 20_000;
    await Promise.all([room.schedule("a", t1), room.schedule("b", t2)]);
    expect(await storage.get("__schedules")).toEqual({ a: t1, b: t2 });
  });

  it("a stop during handleTick is preserved (deleteAll inside a tick)", async () => {
    const { room, storage } = makeRoom();
    room.__conns = [{}]; // occupied room, managed ticker active
    room.shouldTick = () => true;
    room.handleTick = async () => {
      await room.storage.deleteAll(); // stopLoop + wipe, mid-tick
    };
    await room.startLoop(50);
    const keepGoing = await room.runOneTick();
    expect(keepGoing).toBe(false);
    expect(room.ticking).toBe(false); // the tick's write-back must not undo the stop
    expect(await storage.get("__loop_ms")).toBeUndefined();
  });

  it("interleaved cancel + schedule leaves the alarm armed for the survivor", async () => {
    const { room, storage } = makeRoom();
    const t1 = Date.now() + 10_000;
    const t2 = Date.now() + 20_000;
    await room.schedule("a", t1);
    // A stale cancel's rearm must not clobber the newer schedule's alarm.
    await Promise.all([room.cancelSchedule("a"), room.schedule("b", t2)]);
    expect(await storage.get("__schedules")).toEqual({ b: t2 });
    expect(storage.state.alarm).toBe(t2);
  });

  it("cancelSchedule removes the wake and disarms", async () => {
    const { room, storage } = makeRoom();
    await room.schedule("gone", Date.now() + 60_000);
    await room.cancelSchedule("gone");
    expect(await storage.get("__schedules")).toEqual({});
    expect(storage.state.alarm).toBeNull();
  });

  it("with the ticker running, the alarm is the earlier of watchdog and wake", async () => {
    const { room, storage } = makeRoom();
    await room.startLoop(50); // arms the ~30s watchdog
    const watchdog = storage.state.alarm;
    expect(watchdog).not.toBeNull();

    const soon = Date.now() + 1_000; // earlier than the watchdog
    await room.schedule("turn-timeout", soon);
    expect(storage.state.alarm).toBe(soon);

    await room.cancelSchedule("turn-timeout");
    expect(storage.state.alarm).toBeGreaterThanOrEqual(watchdog!);
    await room.stopLoop();
  });
});
