/**
 * The `_b44_error` record every build carries: one log line for a returned 5xx,
 * read the way production reads it, through a Tail Worker attached to the
 * function. Every case runs in real workerd, and the request header is the only
 * switch, so each one is checked with and without `x-b44-feed-context`.
 */

import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { bundle, bundleApp } from "../src/bundler";
import { WFP_COMPAT_DATE } from "./workerd";

const FEED = { "x-b44-feed-context": "1" };

interface ErrorRecord {
  v: number;
  kind: string;
  status: number;
  name?: string;
  message: string;
  stack?: string;
}

interface TailEvent {
  logs: { level: string; message: unknown[] }[];
  exceptions: { name: string; message: string }[];
}

interface Invocation {
  status: number;
  headers: Record<string, string>;
  text: string;
  events: TailEvent[];
  records: ErrorRecord[];
}

// The tail worker forwards each invocation's trace to Node.
const TAIL_SCRIPT = `export default {
  async tail(events, env) {
    await env.SINK.fetch("http://sink/", { method: "POST", body: JSON.stringify(events) });
  },
};`;

/** Each `_b44_error` payload in the trace. The console patch logs one object
 *  whose `message` is the JSON of what the code passed. */
function recordsIn(events: TailEvent[]): ErrorRecord[] {
  const out: ErrorRecord[] = [];
  for (const event of events) {
    for (const log of event.logs) {
      const line = log.message[0] as { message?: unknown };
      if (typeof line?.message !== "string") continue;
      try {
        const parsed = JSON.parse(line.message) as { _b44_error?: ErrorRecord };
        if (parsed?._b44_error) out.push(parsed._b44_error);
      } catch {}
    }
  }
  return out;
}

async function invoke(
  module: string,
  opts: { headers?: Record<string, string>; env?: Record<string, string> } = {},
): Promise<Invocation> {
  const events: TailEvent[] = [];
  const mf = new Miniflare({
    workers: [
      {
        name: "fn",
        modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
        compatibilityDate: WFP_COMPAT_DATE,
        compatibilityFlags: ["nodejs_compat"],
        bindings: opts.env ?? {},
        tails: ["tail"],
      },
      {
        name: "tail",
        modules: true,
        script: TAIL_SCRIPT,
        compatibilityDate: WFP_COMPAT_DATE,
        serviceBindings: {
          SINK: async (req) => {
            events.push(...((await req.json()) as TailEvent[]));
            return new Response("ok");
          },
        },
      },
    ],
  });
  try {
    const res = await mf.dispatchFetch("http://localhost/", { headers: opts.headers });
    const text = await res.text();
    // The trace arrives once the invocation (waitUntil included) is done.
    const until = Date.now() + 5000;
    while (events.length === 0 && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers),
      text,
      events,
      records: recordsIn(events),
    };
  } finally {
    await mf.dispose();
  }
}

async function compile(source: string): Promise<string> {
  const r = await bundle({ entry: "main.ts", files: { "main.ts": source } });
  if (!r.ok) throw new Error(`bundle failed: ${JSON.stringify(r.errors)}`);
  return r.module;
}

async function compileApp(source: string): Promise<string> {
  const r = await bundleApp({
    functions: [{ name: "alpha", entry: "main.ts", files: { "main.ts": source } }],
  });
  if (!r.ok) throw new Error(`bundleApp failed: ${JSON.stringify(r.functions)}`);
  return r.module;
}

const serveJson = (body: unknown, status = 500) =>
  `Deno.serve(() => Response.json(${JSON.stringify(body)}, { status: ${status} }));`;

/** Run with the feed header and without; the record must appear only with it. */
async function recordFor(module: string, env?: Record<string, string>): Promise<ErrorRecord[]> {
  const without = await invoke(module, { env });
  expect(without.records).toEqual([]);
  return (await invoke(module, { headers: FEED, env })).records;
}

describe("the raw Tail log entry", () => {
  // The contract with apper's error tail (workers/base44-log-tail/src/
  // error-tail.ts), which parses exactly this shape in production. The record
  // goes through the console patch, so it is NOT logged as a raw object: a
  // change to the patch must fail here, not silently drop every record.
  const source = 'Deno.serve(() => Response.json({ error: "db down" }, { status: 500 }));';
  const record = { v: 1, kind: "response", status: 500, message: "db down" };

  it.each([
    ["single function", compile, {}, ["_b44_env", "level", "message"], undefined],
    [
      "per-app",
      compileApp,
      { "Base44-Function-Name": "alpha" },
      ["_b44_env", "_b44_function", "level", "message"],
      "alpha",
    ],
  ] as const)("is one 'log' entry wrapping the record as JSON (%s)", async (_label, build, headers, keys, fn) => {
    const run = await invoke(await build(source), { headers: { ...headers, ...FEED } });
    const entries = run.events.flatMap((e) => e.logs).filter((l) => JSON.stringify(l).includes("_b44_error"));
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    // The patch writes every level through the original console.log.
    expect(entry.level).toBe("log");
    expect(entry.message).toHaveLength(1);
    const wrapper = entry.message[0] as Record<string, unknown>;
    expect(Object.keys(wrapper)).toEqual(keys);
    expect(wrapper.level).toBe("error");
    expect(typeof wrapper.message).toBe("string");
    expect(JSON.parse(wrapper.message as string)._b44_error).toEqual(record);
    // Present only in per-app bundles, where one script serves every function.
    expect(wrapper._b44_function).toBe(fn);
  });
});

describe("a 5xx JSON body", () => {
  it.each([
    ["error", { error: "boom-error" }, "boom-error"],
    ["message", { message: "boom-message" }, "boom-message"],
    ["detail", { detail: "boom-detail" }, "boom-detail"],
    ["details", { details: "boom-details" }, "boom-details"],
    ["error.message", { error: { message: "boom-nested" } }, "boom-nested"],
    ["the first non-empty field", { error: " ", message: "", detail: "boom-third" }, "boom-third"],
    ["SSO, with details", { error: "Internal server error", details: "token exchange failed" }, "token exchange failed"],
    ["SSO, without details", { error: "Internal server error" }, "Internal server error"],
  ])("yields one record from %s", async (_label, body, message) => {
    const records = await recordFor(await compile(serveJson(body)));
    expect(records).toEqual([{ v: 1, kind: "response", status: 500, message }]);
  });

  it("skips error only when it is exactly the SSO placeholder", async () => {
    const records = await recordFor(
      await compile(serveJson({ error: "Internal server error!", details: "not this" })),
    );
    expect(records.map((r) => r.message)).toEqual(["Internal server error!"]);
  });

  it("reports the status the handler returned", async () => {
    const records = await recordFor(await compile(serveJson({ error: "unavailable" }, 503)));
    expect(records).toEqual([{ v: 1, kind: "response", status: 503, message: "unavailable" }]);
  });

  it("works the same in the per-app entry", async () => {
    const module = await compileApp(serveJson({ error: "app-boom" }));
    const fnHeader = { "Base44-Function-Name": "alpha" };
    expect((await invoke(module, { headers: fnHeader })).records).toEqual([]);
    const on = await invoke(module, { headers: { ...fnHeader, ...FEED } });
    expect(on.records).toEqual([{ v: 1, kind: "response", status: 500, message: "app-boom" }]);
    // The line goes through the console patch, so it carries attribution.
    const line = on.events.flatMap((e) => e.logs).find((l) => JSON.stringify(l).includes("_b44_error"));
    expect((line?.message[0] as { _b44_function?: string })._b44_function).toBe("alpha");
  });
});

describe("no record", () => {
  it.each([
    ["a 5xx text body", 'Deno.serve(() => new Response("plain failure", { status: 500 }));'],
    ["a 4xx", serveJson({ error: "bad input" }, 400)],
    ["a 2xx", serveJson({ error: "not an error" }, 200)],
    ["a 5xx with no message field", serveJson({ code: 42 })],
    ["a non-Response return", "export default () => ({ status: 500 });"],
  ])("for %s", async (_label, source) => {
    const run = await invoke(await compile(source), { headers: FEED });
    expect(run.events.length).toBeGreaterThan(0);
    expect(run.records).toEqual([]);
  });

  it("for a body over 2 KB, which still reaches the client whole", async () => {
    const body = { error: "too big", pad: "x".repeat(3000) };
    const run = await invoke(await compile(serveJson(body)), { headers: FEED });
    expect(run.records).toEqual([]);
    expect(JSON.parse(run.text)).toEqual(body);
  });

  it("for a streamed body that misses the 50 ms deadline, which still reaches the client whole", async () => {
    const run = await invoke(
      await compile(`
        Deno.serve(() => {
          const enc = new TextEncoder();
          const body = new ReadableStream({
            async start(c) {
              c.enqueue(enc.encode('{"error":"'));
              await new Promise((r) => setTimeout(r, 200));
              c.enqueue(enc.encode('slow"}'));
              c.close();
            },
          });
          return new Response(body, { status: 500, headers: { "content-type": "application/json" } });
        });
      `),
      { headers: FEED },
    );
    expect(run.records).toEqual([]);
    expect(run.text).toBe('{"error":"slow"}');
  });

  it("when anything throws, and the request is unaffected", async () => {
    // A Response whose clone() throws: the recorder gives up, the response stands.
    const run = await invoke(
      await compile(`
        class Unclonable extends Response { clone() { throw new Error("no clone"); } }
        Deno.serve(() => new Unclonable(JSON.stringify({ error: "x" }), { status: 500 }));
      `),
      { headers: FEED },
    );
    expect(run.status).toBe(500);
    expect(run.text).toBe('{"error":"x"}');
    expect(run.records).toEqual([]);
  });
});

describe("a logged Error", () => {
  it("supplies name, message and stack when the body repeats its message", async () => {
    const records = await recordFor(
      await compile(`
        class DbError extends Error { name = "DbError"; }
        Deno.serve(() => {
          try { throw new DbError("db down"); }
          catch (e) {
            console.error("query failed:", e);
            return Response.json({ error: "Something went wrong", details: e.message }, { status: 500 });
          }
        });
      `),
    );
    expect(records).toHaveLength(1);
    const [r] = records;
    expect(r).toMatchObject({ v: 1, kind: "response", status: 500, name: "DbError", message: "db down" });
    expect(r.stack?.split("\n")[0]).toBe("DbError: db down");
    expect(r.stack?.split("\n").length).toBeGreaterThan(1);
  });

  it("still matches when an unrelated Error is logged after it", async () => {
    const records = await recordFor(
      await compile(`
        class DbError extends Error { name = "DbError"; }
        Deno.serve(() => {
          const db = new DbError("db down");
          console.error("query failed:", db);
          console.warn(new Error("cleanup warning"));
          return Response.json({ error: db.message }, { status: 500 });
        });
      `),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: "DbError", message: "db down" });
    expect(records[0].stack?.split("\n")[0]).toBe("DbError: db down");
  });

  it.each([
    [7, { name: "DbError", hasStack: true }],
    [8, { name: undefined, hasStack: false }],
  ])("remembers the last 8 Errors: %i unrelated ones after the match", async (unrelated, expected) => {
    // With 8 later Errors the match has been dropped, so the message comes
    // from the body alone, with no name or stack.
    const [r] = await recordFor(
      await compile(`
        class DbError extends Error { name = "DbError"; }
        Deno.serve(() => {
          console.error(new DbError("db down"));
          for (let i = 0; i < ${unrelated}; i++) console.warn(new Error("noise " + i));
          return Response.json({ error: "db down" }, { status: 500 });
        });
      `),
    );
    expect(r.message).toBe("db down");
    expect(r.name).toBe(expected.name);
    expect(r.stack !== undefined).toBe(expected.hasStack);
  });

  it("falls back to the newest logged Error", async () => {
    const [r] = await recordFor(
      await compile(`
        Deno.serve(() => {
          console.error(new Error("older"));
          console.error(new RangeError("newest"));
          return new Response("oops", { status: 500 });
        });
      `),
    );
    expect(r).toMatchObject({ name: "RangeError", message: "newest" });
  });

  it("is ignored when the body says something else, and gives no stack", async () => {
    const records = await recordFor(
      await compile(`
        Deno.serve(() => {
          console.error(new Error("unrelated warning"));
          return Response.json({ error: "payment failed" }, { status: 500 });
        });
      `),
    );
    expect(records).toEqual([{ v: 1, kind: "response", status: 500, message: "payment failed" }]);
  });

  it("is the fallback when the body has no message", async () => {
    const records = await recordFor(
      await compile(`
        Deno.serve(() => {
          console.warn(new TypeError("cannot read x"));
          return new Response("oops", { status: 500 });
        });
      `),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: "TypeError", message: "cannot read x" });
    expect(records[0].stack).toMatch(/^TypeError: cannot read x\n/);
  });

  it("is per request: an Error logged in an earlier request does not leak", async () => {
    const module = await compile(`
      let n = 0;
      Deno.serve(() => {
        if (n++ === 0) { console.error(new Error("first request")); return new Response("ok"); }
        return new Response("second", { status: 500 });
      });
    `);
    const events: TailEvent[] = [];
    const mf = new Miniflare({
      workers: [
        { name: "fn", modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }], compatibilityDate: WFP_COMPAT_DATE, compatibilityFlags: ["nodejs_compat"], tails: ["tail"] },
        { name: "tail", modules: true, script: TAIL_SCRIPT, compatibilityDate: WFP_COMPAT_DATE, serviceBindings: { SINK: async (req) => { events.push(...((await req.json()) as TailEvent[])); return new Response("ok"); } } },
      ],
    });
    try {
      await (await mf.dispatchFetch("http://localhost/", { headers: FEED })).text();
      await (await mf.dispatchFetch("http://localhost/", { headers: FEED })).text();
      const until = Date.now() + 5000;
      while (events.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    } finally {
      await mf.dispose();
    }
    expect(recordsIn(events)).toEqual([]);
  });
});

describe("bounds and scrubbing", () => {
  it("cuts a non-ASCII message to 500 bytes on a code point", async () => {
    const long = "Ошибка 💥 ".repeat(100);
    const [r] = await recordFor(await compile(serveJson({ error: long })));
    expect(Buffer.byteLength(r.message, "utf8")).toBeLessThanOrEqual(500);
    expect(Buffer.byteLength(r.message, "utf8")).toBeGreaterThan(490);
    expect(long.startsWith(r.message)).toBe(true);
    expect(r.message).not.toContain("�");
  });

  it("replaces a lone surrogate", async () => {
    const [r] = await recordFor(
      await compile('Deno.serve(() => Response.json({ error: "bad \\ud800 half" }, { status: 500 }));'),
    );
    expect(r.message).toBe("bad � half");
  });

  it("scrubs env secrets from the message and the stack, longest first", async () => {
    const env = {
      API_KEY: "sk_live_0123456789abcdef",
      API_KEY_PREFIX: "sk_live_0123",
      SHORT: "tiny",
      PDS: JSON.stringify({ db: { password: "hunter2-hunter2" } }),
    };
    const records = await recordFor(
      await compile(`
        Deno.serve(() => {
          const e = new Error("auth failed for sk_live_0123456789abcdef and sk_live_0123 (tiny) pw hunter2-hunter2");
          console.error(e);
          return Response.json({ error: e.message }, { status: 500 });
        });
      `),
      env,
    );
    expect(records).toHaveLength(1);
    const [r] = records;
    expect(r.message).toBe("auth failed for [redacted] and [redacted] (tiny) pw [redacted]");
    expect(r.stack?.split("\n")[0]).toBe(`Error: ${r.message}`);
    const json = JSON.stringify(r);
    for (const secret of ["sk_live_0123", "hunter2-hunter2"]) expect(json).not.toContain(secret);
  });

  it.each([
    ["an object after a newline", '\n{"db":{"password":"private-password-123"}}'],
    ["an array after spaces", '  [ "private-password-123" ]'],
    ["an object after mixed whitespace", '\r\n\t {"nested":{"deeper":"private-password-123"}}'],
  ])("scrubs a JSON binding that starts with whitespace (%s)", async (_label, binding) => {
    const records = await recordFor(
      await compile('Deno.serve(() => Response.json({ error: "login failed with private-password-123" }, { status: 500 }));'),
      { PDS: binding },
    );
    expect(records.map((r) => r.message)).toEqual(["login failed with [redacted]"]);
  });

  it("keeps the stack under 4 KB, cut at a line end", async () => {
    const [r] = await recordFor(
      await compile(`
        Deno.serve(() => {
          const e = new Error("deep");
          e.stack = "Error: deep\\n" + Array.from({ length: 200 }, (_, i) => "    at frame" + i + " (file:///main.ts:" + i + ":1)").join("\\n");
          console.error(e);
          return Response.json({ error: "deep" }, { status: 500 });
        });
      `),
    );
    expect(Buffer.byteLength(r.stack!, "utf8")).toBeLessThanOrEqual(4096);
    expect(r.stack!.split("\n").at(-1)).toMatch(/^ {4}at frame\d+ \(file:\/\/\/main\.ts:\d+:1\)$/);
  });

  it("caps the name at 64 characters", async () => {
    const [r] = await recordFor(
      await compile(`
        Deno.serve(() => {
          const e = new Error("named");
          e.name = "N".repeat(100);
          console.error(e);
          return Response.json({ error: "named" }, { status: 500 });
        });
      `),
    );
    expect(r.name).toBe("N".repeat(64));
  });
});

describe("the response", () => {
  const source = `
    Deno.serve(() => {
      console.error(new Error("db down"));
      return Response.json({ error: "db down" }, { status: 500, headers: { "x-app": "kept" } });
    });
  `;

  it("is the same response, with or without the record", async () => {
    const module = await compile(source);
    const off = await invoke(module);
    const on = await invoke(module, { headers: FEED });
    expect(on.records).toHaveLength(1);
    expect(off.records).toEqual([]);
    expect({ status: on.status, headers: on.headers, text: on.text }).toEqual({
      status: off.status,
      headers: off.headers,
      text: off.text,
    });
  });

  it("is not held back while the record is written", async () => {
    // The response must reach the client while the handler's stream is still
    // open: nothing waits on the recorder's read of the clone. (Miniflare's
    // dispatchFetch hands over this body only once it closes, with or without
    // the recorder, so the headers are what can be timed here.)
    const module = await compile(`
      Deno.serve(() => {
        const enc = new TextEncoder();
        const body = new ReadableStream({
          async start(c) {
            c.enqueue(enc.encode('{"error":"slow'));
            await new Promise((r) => setTimeout(r, 600));
            c.enqueue(enc.encode(' tail"}'));
            c.close();
          },
        });
        return new Response(body, { status: 500 });
      });
    `);
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
    });
    try {
      await mf.ready;
      const started = Date.now();
      const res = await mf.dispatchFetch("http://localhost/", { headers: FEED });
      expect(res.status).toBe(500);
      // The handler's stream stays open for 600 ms.
      expect(Date.now() - started).toBeLessThan(400);
      expect(await res.text()).toBe('{"error":"slow tail"}');
    } finally {
      await mf.dispose();
    }
  });
});

describe("an uncaught throw", () => {
  const source = 'Deno.serve(() => { throw new Error("kaboom"); });';

  it.each([
    ["single function", compile, {}],
    ["per-app", compileApp, { "Base44-Function-Name": "alpha" }],
  ] as const)("still rethrows exactly as today (%s)", async (_label, build, headers) => {
    const module = await build(source);
    const off = await invoke(module, { headers });
    const on = await invoke(module, { headers: { ...headers, ...FEED } });
    // Cloudflare records the exception; the record is only for returned 5xx.
    expect(on.events.flatMap((e) => e.exceptions).map((x) => x.message)).toEqual(["kaboom"]);
    expect(off.events.flatMap((e) => e.exceptions).map((x) => x.message)).toEqual(["kaboom"]);
    expect(on.records).toEqual([]);
    expect({ status: on.status, text: on.text }).toEqual({ status: off.status, text: off.text });
  });
});
