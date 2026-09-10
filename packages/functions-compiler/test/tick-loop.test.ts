import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TickLoop } from "../src/shim/tick-loop";

describe("TickLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks at the requested cadence without drift", async () => {
    let ticks = 0;
    const loop = new TickLoop(() => {
      ticks++;
      return true;
    });
    loop.start(100);
    await vi.advanceTimersByTimeAsync(1000);
    // Drift-corrected schedule: 1000ms / 100ms = exactly 10 ticks, not ~9
    // as a naive re-setTimeout-after-work chain would give.
    expect(ticks).toBe(10);
    loop.stop();
  });

  it("caps catch-up after a stall and drops the remaining debt", async () => {
    let ticks = 0;
    const loop = new TickLoop(async () => {
      ticks++;
      // The first tick stalls the loop for 1s (event-loop hiccup simulation).
      if (ticks === 1) await new Promise<void>((r) => setTimeout(r, 1000));
      return true;
    }, 3);
    loop.start(100);
    // t=100 the first tick starts and finishes at t=1100 — 10 intervals of
    // debt. A naive loop would burst through all of them (visible teleport);
    // the cap runs 2 more catch-up steps (3 total) and drops the rest.
    await vi.advanceTimersByTimeAsync(1100);
    expect(ticks).toBe(3);
    // The schedule re-anchors to now — the next tick comes one interval later.
    await vi.advanceTimersByTimeAsync(100);
    expect(ticks).toBe(4);
    loop.stop();
  });

  it("stops when the callback returns false", async () => {
    let ticks = 0;
    const loop = new TickLoop(() => {
      ticks++;
      return ticks < 3;
    });
    loop.start(50);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks).toBe(3);
    expect(loop.isRunning).toBe(false);
  });

  it("start() with a NEW interval while running reschedules to the new cadence", async () => {
    let ticks = 0;
    const loop = new TickLoop(() => {
      ticks++;
      return true;
    });
    loop.start(100);
    await vi.advanceTimersByTimeAsync(200); // 2 ticks at 100ms
    expect(ticks).toBe(2);
    loop.start(50); // speed up mid-run (legacy startLoop(newMs) pattern)
    await vi.advanceTimersByTimeAsync(200); // 4 more ticks at 50ms
    expect(ticks).toBe(6);
    loop.stop();
  });

  it("start() with a new interval from INSIDE a tick does not fork a second loop", async () => {
    let ticks = 0;
    let loop: TickLoop;
    loop = new TickLoop(() => {
      ticks++;
      if (ticks === 2) loop.start(50); // legacy startLoop(newMs) inside handleTick
      return true;
    });
    loop.start(100);
    await vi.advanceTimersByTimeAsync(200); // ticks 1,2 at 100ms; change fires on tick 2
    expect(ticks).toBe(2);
    await vi.advanceTimersByTimeAsync(200); // 4 more ticks at 50ms — doubled loops would give ~8
    expect(ticks).toBe(6);
    loop.stop();
  });

  it("stop() cancels the pending timer and start() is idempotent while running", async () => {
    let ticks = 0;
    const loop = new TickLoop(() => {
      ticks++;
      return true;
    });
    loop.start(100);
    loop.start(100); // no double-scheduling
    await vi.advanceTimersByTimeAsync(250);
    expect(ticks).toBe(2);
    loop.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(ticks).toBe(2);
    expect(loop.isRunning).toBe(false);
  });

  it("awaits an async callback before scheduling the next tick (no overlap)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let ticks = 0;
    const loop = new TickLoop(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      ticks++;
      await new Promise<void>((r) => setTimeout(r, 30));
      inFlight--;
      return true;
    });
    loop.start(50);
    await vi.advanceTimersByTimeAsync(500);
    expect(maxInFlight).toBe(1);
    expect(ticks).toBeGreaterThanOrEqual(5);
    loop.stop();
  });
});

it("keeps scheduling when the tick callback throws", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const loop = new TickLoop(() => {
    calls++;
    if (calls === 1) throw new Error("state not ready");
    return true;
  });
  loop.start(10);
  await vi.advanceTimersByTimeAsync(11);   // first tick throws
  expect(loop.isRunning).toBe(true);       // running survives the throw
  await vi.advanceTimersByTimeAsync(10);   // and the NEXT tick still fires
  expect(calls).toBeGreaterThanOrEqual(2);
  loop.stop();
  vi.useRealTimers();
});

it("a stale run resuming after stop+restart does not arm a second timer", async () => {
  vi.useFakeTimers();
  let resolveTick: ((v: boolean) => void) | null = null;
  let ticks = 0;
  const loop = new TickLoop(() => {
    ticks++;
    return new Promise<boolean>((res) => { resolveTick = res; });
  });
  loop.start(10);
  await vi.advanceTimersByTimeAsync(11);   // tick 1 starts, awaits
  expect(ticks).toBe(1);
  loop.stop();
  loop.start(10);                          // restart while tick 1 still pending
  resolveTick!(true);                      // stale run resumes — must NOT schedule
  await vi.advanceTimersByTimeAsync(1);
  const before = ticks;
  await vi.advanceTimersByTimeAsync(100);  // only the restarted loop's cadence
  // one timer → at most ~10 additional tick STARTS in 100ms; a doubled loop
  // would produce roughly twice that. Each tick awaits forever until resolved,
  // so exactly ONE new tick fires per armed timer chain: assert single-start.
  expect(ticks - before).toBe(1);
  loop.stop();
  vi.useRealTimers();
});
