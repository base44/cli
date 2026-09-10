/**
 * `bundleApp` can succeed and still report a failed function. The HTTP service
 * depends on that (it deploys the good ones and attributes the failures), and a
 * whole-app CLI build must refuse it. Both readings need the behaviour pinned
 * here rather than only in apper's endpoint specs.
 *
 * Every fixture fails for a resolution reason the compiler decides on its own,
 * so these run without touching a registry.
 */

import { describe, expect, it } from "vitest";

import { bundleApp } from "../src/bundler";

const ok = (name: string) => ({
  name,
  entry: "main.ts",
  files: { "main.ts": `Deno.serve(() => new Response("${name}"));` },
});

const broken = (name: string) => ({
  name,
  entry: "main.ts",
  files: {
    "main.ts": `import { x } from "./not-submitted.ts";\nDeno.serve(() => new Response(x));`,
  },
});

describe("bundleApp partial results", () => {
  it("returns a module for the survivors and marks the broken function failed", async () => {
    const result = await bundleApp({
      functions: [ok("alpha"), broken("beta"), ok("gamma")],
    });

    expect(result.ok).toBe(true);
    const byName = Object.fromEntries(result.functions.map((f) => [f.name, f]));
    expect(byName.alpha.ok).toBe(true);
    expect(byName.gamma.ok).toBe(true);
    expect(byName.beta.ok).toBe(false);

    // The survivors are routable; the failure carries a diagnostic the author
    // can act on, against their own path.
    expect(result.ok && result.module).toContain("alpha");
    expect(result.ok && result.module).toContain("gamma");
    if (byName.beta.ok === false) {
      const [error] = byName.beta.errors;
      expect(error.message).toContain("./not-submitted.ts");
      expect(error.file).toBe("main.ts");
    }
  });

  it("reports every function and produces no module when none compile", async () => {
    const result = await bundleApp({
      functions: [broken("alpha"), broken("beta")],
    });

    expect(result.ok).toBe(false);
    expect(result.module).toBeNull();
    expect(result.functions.map((f) => f.name)).toEqual(["alpha", "beta"]);
    expect(result.functions.every((f) => !f.ok)).toBe(true);
  });

  it("keeps every declared function in the response exactly once", async () => {
    // A whole-app build checks this before it trusts the result; a name that
    // silently vanished would deploy an app missing a handler.
    const names = ["alpha", "beta", "gamma", "delta"];
    const result = await bundleApp({
      functions: [ok("alpha"), broken("beta"), ok("gamma"), ok("delta")],
    });
    expect(result.functions.map((f) => f.name).sort()).toEqual([...names].sort());
  });

  it("refuses a reserved platform filename outright", async () => {
    const result = await bundleApp({
      functions: [
        {
          name: "spoofer",
          entry: "main.ts",
          files: {
            "main.ts": 'Deno.serve(() => new Response("x"));',
            // The activation shim is the only importer allowed to reach the
            // private-data-source manifest store, and that gate keys on this
            // basename — so it is reserved at any depth, in every mode.
            "nested/__base44_activation.mjs": "export const forged = 1;",
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    const [fn] = result.functions;
    expect(fn.ok).toBe(false);
    if (fn.ok === false) {
      expect(fn.errors[0].message).toContain("__base44_activation.mjs");
    }
  });
});

describe("what a combined build does NOT isolate", () => {
  it("lets one function import another's source (characterization)", async () => {
    // `prepareApp` namespaces each function under `fn_<index>/` and its comment
    // claims the keyspaces are sealed. They are not: the user-files resolver
    // only checks membership in the flat map, so `../fn_1/main.ts` resolves.
    //
    // Both functions belong to the same app and ship in the same Worker, so
    // this is intra-tenant — and the manifest-store gate above is what actually
    // protects credentials. Pinned rather than asserted-against so a decision
    // to confine the resolver flips this test deliberately.
    const result = await bundleApp({
      functions: [
        {
          name: "reader",
          entry: "main.ts",
          files: {
            "main.ts": 'import { marker } from "../fn_1/main.ts";\nDeno.serve(() => new Response(marker));',
          },
        },
        {
          name: "neighbour",
          entry: "main.ts",
          files: {
            "main.ts": 'export const marker = "neighbour-source";\nDeno.serve(() => new Response("ok"));',
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.functions.every((f) => f.ok)).toBe(true);
  });
});
