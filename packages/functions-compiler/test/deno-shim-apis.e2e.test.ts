// Proves the vendored @deno/shim-deno surface actually runs under workerd
// (nodejs_compat), not just that it bundles.

import { describe, expect, it } from "vitest";

import { bundleOrThrow } from "./helpers";
import { runInWorkerd } from "./workerd";

describe("Deno API surface in workerd (vendored @deno/shim-deno)", () => {
  it("Deno.writeTextFile + readTextFile round-trip in the in-memory FS", async () => {
    const m = await bundleOrThrow(`
      Deno.serve(async () => {
        const path = "/tmp/hello.txt";
        await Deno.writeTextFile(path, "hi from deno fs");
        return new Response(await Deno.readTextFile(path));
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("hi from deno fs");
  });

  it("Deno.writeFile + readFile round-trip bytes", async () => {
    const m = await bundleOrThrow(`
      Deno.serve(async () => {
        const path = "/tmp/bytes.bin";
        const data = new Uint8Array([0, 1, 2, 250, 255]);
        await Deno.writeFile(path, data);
        const back = await Deno.readFile(path);
        const equal = back.length === data.length && back.every((b, i) => b === data[i]);
        return new Response(String(equal));
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  it("Deno.mkdir (recursive) + readDir lists created entries", async () => {
    const m = await bundleOrThrow(`
      Deno.serve(async () => {
        await Deno.mkdir("/tmp/d/sub", { recursive: true });
        await Deno.writeTextFile("/tmp/d/a.txt", "a");
        await Deno.writeTextFile("/tmp/d/b.txt", "b");
        const entries = [];
        for await (const e of Deno.readDir("/tmp/d")) {
          entries.push(e.name + ":" + (e.isFile ? "f" : e.isDirectory ? "d" : "?"));
        }
        entries.sort();
        return Response.json(entries);
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual(["a.txt:f", "b.txt:f", "sub:d"]);
  });

  it("Deno.makeTempFile creates writable scratch space", async () => {
    const m = await bundleOrThrow(`
      Deno.serve(async () => {
        const file = await Deno.makeTempFile();
        await Deno.writeTextFile(file, "scratch");
        return Response.json({
          isString: typeof file === "string",
          content: await Deno.readTextFile(file),
        });
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ isString: true, content: "scratch" });
  });

  it("Deno.stat reports file info; remove deletes (Deno.errors.NotFound)", async () => {
    const m = await bundleOrThrow(`
      Deno.serve(async () => {
        const path = "/tmp/s.txt";
        await Deno.writeTextFile(path, "12345");
        const info = await Deno.stat(path);
        await Deno.remove(path);
        let notFound = false;
        try { await Deno.stat(path); }
        catch (e) { notFound = e instanceof Deno.errors.NotFound; }
        // no mtime: CF's node:fs returns the Unix epoch.
        return Response.json({ isFile: info.isFile, size: info.size, notFound });
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ isFile: true, size: 5, notFound: true });
  });

  it("Deno.memoryUsage returns a numeric memory snapshot", async () => {
    const m = await bundleOrThrow(`
      Deno.serve(() => {
        const u = Deno.memoryUsage();
        const ok = ["rss", "heapTotal", "heapUsed", "external"]
          .every((k) => typeof u[k] === "number");
        return new Response(String(ok));
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("true");
  });

  it("Deno.cwd returns a string path", async () => {
    const m = await bundleOrThrow(
      "Deno.serve(() => new Response(typeof Deno.cwd()));",
    );
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    expect(text).toBe("string");
  });

  // Network-dependent: CF resolves node:dns via DoH (1.1.1.1).
  it("Deno.resolveDns resolves NS records via DoH", async () => {
    const m = await bundleOrThrow(`
      Deno.serve(async () => {
        try {
          const records = await Deno.resolveDns("cloudflare.com", "NS");
          return Response.json({ ok: Array.isArray(records) && records.length > 0 });
        } catch (e) {
          return Response.json({ ok: false, error: e?.message ?? String(e) });
        }
      });
    `);
    const { status, text } = await runInWorkerd(m);
    expect(status).toBe(200);
    const body = JSON.parse(text) as { ok: boolean; error?: string };
    // Tolerate an egress failure, but not a broken shim (missing API).
    expect(body.error ?? "").not.toMatch(
      /is not a function|Cannot read|Dynamic require|No such module/,
    );
    expect(body.ok).toBe(true);
  });
});
