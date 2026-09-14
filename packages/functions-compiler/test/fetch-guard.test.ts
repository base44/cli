import { describe, expect, it, vi } from "vitest";

import { createGuardedFetch } from "../src/fetch-guard";

describe("fetch guard — host allowlist", () => {
  it("blocks any host outside the allowlist", async () => {
    const original = vi.fn();
    const guarded = createGuardedFetch(original as unknown as typeof fetch);

    for (const url of [
      "https://evil.example.com/payload.ts",
      "https://github.com/owner/repo/raw/main/x.ts",
      "https://cdn.skypack.dev/lodash",
    ]) {
      await expect(guarded(url)).rejects.toThrow(/disallowed host/);
    }
    expect(original).not.toHaveBeenCalled();
  });

  it("allows the npm/jsr registries and the esm.sh / deno.land CDNs (incl. subdomains)", async () => {
    const original = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedFetch(original as unknown as typeof fetch);

    const urls = [
      "https://registry.npmjs.org/zod",
      "https://registry.npmjs.org/zod/-/zod-3.23.8.tgz",
      "https://jsr.io/@std/encoding/meta.json",
      "https://npm.jsr.io/@jsr/std__encoding",
      "https://esm.sh/is-odd@3.0.1",
      "https://cdn.esm.sh/v135/is-number@7.0.0/es2022/is-number.mjs",
      "https://deno.land/std@0.224.0/encoding/base64.ts",
    ];
    for (const url of urls) await guarded(url);
    expect(original).toHaveBeenCalledTimes(urls.length);
  });
});

describe("fetch guard — size cap (Content-Length)", () => {
  it("returns the original Response object — never rewraps the body", async () => {
    // The body stream must reach the loader untouched: rewrapping it
    // (TransformStream) corrupts delivery under a live node:http server.
    const original = new Response("data");
    const guarded = createGuardedFetch(
      (async () => original) as unknown as typeof fetch,
      1024,
    );
    const res = await guarded("https://registry.npmjs.org/x");
    expect(res).toBe(original);
    expect(await res.text()).toBe("data");
  });

  it("rejects when Content-Length exceeds the cap (without reading the body)", async () => {
    const original = async () =>
      new Response("x".repeat(50), { headers: { "content-length": "50" } });
    const guarded = createGuardedFetch(original as unknown as typeof fetch, 8);

    await expect(guarded("https://registry.npmjs.org/big.tgz")).rejects.toThrow(
      /limit/,
    );
  });

  it("passes a streamed response with no Content-Length through (not capped)", async () => {
    // A stream body has no Content-Length, so the cap can't apply — it must
    // still pass through untouched rather than be blocked or rewrapped.
    const original = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("x".repeat(50)));
            c.close();
          },
        }),
      );
    const guarded = createGuardedFetch(original as unknown as typeof fetch, 8);

    const res = await guarded("https://registry.npmjs.org/streamed");
    expect((await res.text()).length).toBe(50);
  });
});
