/**
 * The invoke response carries this invocation's own console lines — when asked.
 *
 * Runs the real CONSOLE_PATCH + INVOCATION_LOGS_PATCH in workerd (Miniflare),
 * assembled into a minimal module the same way the console-patch tests do —
 * no npm resolution, so these stay fast and offline.
 */

import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";

import {
  CAPTURE_LOGS_HEADER,
  INVOCATION_LOGS_HEADER,
  INVOCATION_LOGS_PATCH,
  MAX_CAPTURED_LINES,
} from "../src/invocation-logs";
import { CONSOLE_PATCH } from "../src/worker-entry";
import { WFP_COMPAT_DATE } from "./workerd";

const PROXY_HEADER_BUDGET = 8192;

/** A stand-in entry with production's prelude, store seeding and crash frame
 *  (`buildAppEntrySource`, src/worker-entry.ts). `handlerBody` runs inside the
 *  request store, exactly where a user handler runs. The outer catch stands in
 *  for the dispatcher, which answers a throw with a Response of its own built
 *  outside the request store (`mapDispatchError`). */
const entry = (handlerBody: string) => `
import { AsyncLocalStorage } from 'node:async_hooks';
const _b44Store = new AsyncLocalStorage();
const _b44Context = () => _b44Store.getStore();
${CONSOLE_PATCH}
${INVOCATION_LOGS_PATCH}
export default {
  async fetch(request, env, ctx) {
    try {
      return await _b44Store.run({ env: 'preview', secrets: env, workerEnv: env, waitUntil: (p) => ctx.waitUntil(p), ..._b44CaptureStore(request) }, async () => {
        const handler = async () => { ${handlerBody} };
        try {
          return _b44AttachInvocationLogs(await handler());
        } catch (e) {
          console.error(e);
          const crash = _b44CrashResponse(e);
          if (crash) return crash;
          throw e;
        }
      });
    } catch {
      return new Response(JSON.stringify({ error: 'dispatcher' }), { status: 500 });
    }
  },
};
`;

async function invoke(handlerBody: string, { capture = true } = {}) {
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "_bundled.mjs", contents: entry(handlerBody) }],
    compatibilityDate: WFP_COMPAT_DATE,
    compatibilityFlags: ["nodejs_compat"],
  });
  try {
    const res = await mf.dispatchFetch("http://localhost/", {
      headers: capture ? { [CAPTURE_LOGS_HEADER]: "1" } : {},
    });
    const text = await res.text();
    const header = res.headers.get(INVOCATION_LOGS_HEADER);
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: () => JSON.parse(text),
      header,
      payload: header === null ? null : JSON.parse(header),
    };
  } finally {
    await mf.dispose();
  }
}

describe("a request that did not ask for its logs", () => {
  it("gets no header and pays no capture cost", async () => {
    const { status, headers, text, json, header } = await invoke(
      `console.log("hi"); return new Response("ok");`,
      { capture: false },
    );

    expect(status).toBe(200);
    expect(header).toBeNull();
  });

  it("keeps rethrow semantics: the crash escapes to the dispatcher", async () => {
    const { status, headers, text, json, header } = await invoke(`throw new Error("boom");`, { capture: false });

    expect(status).toBe(500);
    expect(json()).toEqual({ error: "dispatcher" });
    expect(header).toBeNull();
  });
});

describe("invocation logs on the response", () => {
  it("returns the lines this invocation logged, with their levels", async () => {
    const { status, headers, text, json, payload } = await invoke(`
      console.log("starting");
      console.error("boom", new Error("bad").message);
      console.warn("%s items", 3);
      return new Response("ok");
    `);

    expect(status).toBe(200);
    expect(text).toBe("ok");
    expect(payload.lines).toEqual([
      { level: "info", message: "starting" },
      { level: "error", message: "boom bad" },
      { level: "warn", message: "3 items" },
    ]);
    expect(payload.dropped).toBe(0);
  });

  it("still answers for a silent invocation — an empty list, not a missing header", async () => {
    // Absence of the header is the "app has not rebundled" signal, so a quiet
    // request must not look like one.
    const { header, payload } = await invoke(`return new Response("ok");`);

    expect(header).not.toBeNull();
    expect(payload).toEqual({ lines: [], dropped: 0 });
  });

  it("caps the line count and reports the overflow instead of hiding it", async () => {
    const { payload } = await invoke(`
      for (let i = 0; i < ${MAX_CAPTURED_LINES + 20}; i++) console.log("line " + i);
      return new Response("ok");
    `);

    expect(payload.lines).toHaveLength(MAX_CAPTURED_LINES);
    expect(payload.lines[0].message).toBe("line 0");
    expect(payload.dropped).toBe(20);
  });

  it("keeps the header inside the proxy's budget however much is logged", async () => {
    // The backend drops an oversized header outright, so the budget has to hold
    // for adversarial content too — quotes and newlines are what JSON escaping
    // expands, and the cap is charged in encoded bytes for that reason.
    const { header, payload } = await invoke(`
      for (let i = 0; i < ${MAX_CAPTURED_LINES}; i++) console.log('"'.repeat(400) + "\\n");
      return new Response("ok");
    `);

    expect(header!.length).toBeLessThan(PROXY_HEADER_BUDGET);
    expect(payload.dropped).toBeGreaterThan(0);
  });

  it("sends only the drop count when the function's own headers leave no room, keeping the response intact", async () => {
    // Capture-on must never break a response that works capture-off, and the
    // tool must not mistake the squeeze for a missing capability (store fallback).
    const { status, headers, text, json, header, payload } = await invoke(`
      for (let i = 0; i < ${MAX_CAPTURED_LINES}; i++) console.log("a line of ordinary length " + i);
      return new Response("ok", { headers: { "Set-Cookie": "session=" + "x".repeat(6000) } });
    `);

    expect(status).toBe(200);
    expect(text).toBe("ok");
    expect(headers.get("Set-Cookie")).toHaveLength("session=".length + 6000);
    expect(header!.length).toBeLessThan(40);
    expect(payload).toEqual({ lines: [], dropped: MAX_CAPTURED_LINES });
  });

  it("omits even the drop count when the function's headers already fill the budget", async () => {
    const { status, headers, text, json, header } = await invoke(`
      console.log("hi");
      return new Response("ok", { headers: { "Set-Cookie": "session=" + "x".repeat(7200) } });
    `);

    expect(status).toBe(200);
    expect(headers.get("Set-Cookie")).toHaveLength("session=".length + 7200);
    expect(header).toBeNull();
  });

  it("escapes non-ASCII text instead of losing the whole header to it", async () => {
    // headers.set throws on any code unit above 0xff, and the attach swallows
    // that — so without escaping, one emoji costs the request every line it
    // logged and the tool silently falls back to the stale store.
    const message = "שלום 😀 café";
    const { header, payload } = await invoke(`
      console.log(${JSON.stringify(message)});
      return new Response("ok");
    `);

    expect(header).not.toBeNull();
    expect(/[^\x00-\x7f]/.test(header!)).toBe(false);
    expect(payload.lines[0].message).toBe(message);
  });

  it("passes the handler's own status, body and headers through the wrap", async () => {
    const { status, headers, text, json } = await invoke(`
      console.log("hi");
      return new Response("nope", { status: 418, headers: { "X-Fn": "kept" } });
    `);

    expect(status).toBe(418);
    expect(text).toBe("nope");
    expect(headers.get("X-Fn")).toBe("kept");
  });

  it("answers a crash with the dispatcher's body shape and the crash's own lines attached", async () => {
    const { status, headers, text, json, payload } = await invoke(`
      console.log("before the crash");
      throw new Error("boom");
    `);

    expect(status).toBe(500);
    expect(json()).toEqual({
      error: "user-exception",
      detail: "user worker threw an exception",
    });
    expect(payload.lines[0]).toEqual({ level: "info", message: "before the crash" });
    expect(payload.lines[1].level).toBe("error");
    expect(payload.lines[1].message).toContain("Error: boom");
  });

  it("lets a quota error escape so the dispatcher's own classification stands", async () => {
    const { status, headers, text, json, header } = await invoke(`throw new Error("Too many subrequests.");`);

    expect(status).toBe(500);
    expect(json()).toEqual({ error: "dispatcher" });
    expect(header).toBeNull();
  });
});
