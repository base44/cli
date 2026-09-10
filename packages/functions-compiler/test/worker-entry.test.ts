import { describe, expect, it } from "vitest";

import { prepareApp, prepareFunction } from "../src/worker-entry";
import { DenoCompatError } from "../src/errors";
import { STATIC_EGRESS_ARTIFACT_MARKER } from "../src/static-egress";

const serve = (body: string) =>
  `Deno.serve(() => new Response(${JSON.stringify(body)}));`;

describe("prepareFunction", () => {
  it("injects a shim and a wrapper entry that delegates to the Deno.serve handler", async () => {
    const result = await prepareFunction("main.ts", { "main.ts": serve("ok") });

    // The build entry is the injected wrapper, not the user's file.
    expect(result.entry).not.toBe("main.ts");
    const workerEntry = result.files[result.entry];
    expect(workerEntry).toContain("getRegisteredHandler");
    expect(workerEntry).toContain('"./main.ts"');
    expect(workerEntry).toContain("installStaticEgressFetch()");
    expect(workerEntry).toContain("runWithWorkerEnvironment as _b44Run");
    expect(workerEntry).toContain("workerEnv: env");
    expect(workerEntry).not.toContain("base44.workerEnvironment");
    expect(workerEntry).not.toContain("Symbol.for");
    expect(workerEntry.indexOf("installStaticEgressFetch()")).toBeLessThan(
      workerEntry.indexOf('import("./main.ts")'),
    );
    const shim = result.files["__base44_deno_shim.mjs"];
    expect(shim).toContain("globalThis.Deno");
    expect(shim).toContain(STATIC_EGRESS_ARTIFACT_MARKER);
    expect(shim).toContain("function serve");
    expect(shim).not.toContain("cloudflareEnv");
  });

  it("falls back to the module's default export when no Deno.serve handler registered", async () => {
    const result = await prepareFunction("main.ts", { "main.ts": serve("ok") });
    const entry = result.files[result.entry];
    expect(entry).toContain("getRegisteredHandler() ?? (typeof _b44Mod?.default === 'function'");
    expect(entry).toContain("export default a request handler or call Deno.serve()");
  });

  it("exposes secrets and the EdgeRuntime alias through the prelude", async () => {
    const result = await prepareFunction("main.ts", { "main.ts": serve("ok") });
    const entry = result.files[result.entry];
    // The Worker env binding rides the request store; the Base44 global (the
    // bridge behind base44:runtime) reads it back with a string filter.
    expect(entry).toContain("secrets: env,");
    expect(entry).toContain("typeof _v === 'string' ? _v : undefined");
    expect(entry).toContain("globalThis.EdgeRuntime = globalThis.EdgeRuntime ??");
  });

  it("rejects reserved injected filenames in the input", async () => {
    await expect(
      prepareFunction("main.ts", {
        "main.ts": serve("ok"),
        "__base44_entry.mjs": "malicious",
      }),
    ).rejects.toThrowError(DenoCompatError);
  });

  it("bakes the activation gate before the user import only in runtime-secrets mode", async () => {
    const plain = await prepareFunction("main.ts", { "main.ts": serve("ok") });
    expect(plain.files[plain.entry]).not.toContain("ensureActivation");
    expect(plain.files["__base44_activation.mjs"]).toBeUndefined();

    const gated = await prepareFunction("main.ts", { "main.ts": serve("ok") }, false, true);
    const entry = gated.files[gated.entry];
    expect(gated.files["__base44_activation.mjs"]).toContain("X-Base44-Needs-Activation");
    // Gate ordering: activation must resolve before any user module loads,
    // the envelope is stripped from the request, and a forged signal is
    // stripped from the user handler's response.
    expect(entry.indexOf("ensureActivation")).toBeLessThan(entry.indexOf("_b44Init ="));
    expect(entry).toContain("withoutRuntimeSecretsHeader(request)");
    expect(entry).toContain("withoutActivationSignal(");
  });

  it("reserves the activation filename in EVERY mode (store gate keys on it)", async () => {
    // The manifest-store allow-list keys on this basename, so a user file with
    // it could forge the PDS manifest even in flag-off / actor bundles (where no
    // shim is injected). Reserve it unconditionally, like shim/entry.
    const files = { "main.ts": serve("ok"), "__base44_activation.mjs": "user file" };
    await expect(prepareFunction("main.ts", files)).rejects.toThrowError(DenoCompatError);
    await expect(prepareFunction("main.ts", files, false, true)).rejects.toThrowError(
      DenoCompatError,
    );
  });

  it("reserves the activation-shim basename at ANY depth, in every mode", async () => {
    // A user file NAMED like the shim at a nested path must not slip past the
    // reservation and pose as the injected shim to reach the PDS manifest store.
    const files = { "main.ts": serve("ok"), "sub/__base44_activation.mjs": "user file" };
    const err = /Reserved filename "__base44_activation\.mjs".*sub\/__base44_activation\.mjs/;
    await expect(prepareFunction("main.ts", files)).rejects.toThrowError(err);
    await expect(prepareFunction("main.ts", files, false, true)).rejects.toThrowError(err);
  });
});

describe("prepareApp", () => {
  it("namespaces each function under fn_<index>/, with one shim and a router that imports every wrapper", () => {
    const result = prepareApp([
      {
        index: 0,
        fn: {
          name: "alpha",
          entry: "main.ts",
          files: { "main.ts": serve("a"), "helper.ts": "export const x = 1;" },
        },
      },
      {
        index: 1,
        fn: { name: "beta", entry: "main.ts", files: { "main.ts": serve("b") } },
      },
    ]);

    expect(result.entry).toBe("__base44_entry.mjs");
    // User files live under their function's namespace (sealed from siblings).
    expect(result.files["fn_0/main.ts"]).toContain("a");
    expect(result.files["fn_0/helper.ts"]).toContain("= 1");
    expect(result.files["fn_1/main.ts"]).toContain("b");
    // One register-wrapper per function, importing into that namespace lazily.
    expect(result.files["__base44_fn_0.mjs"]).toContain('registerLazy("alpha"');
    expect(result.files["__base44_fn_0.mjs"]).toContain(
      'import("./fn_0/main.ts")',
    );
    expect(result.files["__base44_fn_1.mjs"]).toContain('registerLazy("beta"');
    // One shared shim and a router that imports every wrapper and dispatches.
    expect(result.files["__base44_deno_shim.mjs"]).toContain("globalThis.Deno");
    expect(result.files["__base44_entry.mjs"]).toContain(
      'import "./__base44_fn_0.mjs"',
    );
    expect(result.files["__base44_entry.mjs"]).toContain(
      'import "./__base44_fn_1.mjs"',
    );
    expect(result.files["__base44_entry.mjs"]).toContain("resolveHandler");
    expect(result.files["__base44_entry.mjs"]).toContain(
      "installStaticEgressFetch()",
    );
    expect(result.files["__base44_entry.mjs"]).toContain(
      "runWithWorkerEnvironment as _b44Run",
    );
    expect(result.files["__base44_entry.mjs"]).toContain("workerEnv: env");
    expect(result.files["__base44_entry.mjs"]).not.toContain(
      "base44.workerEnvironment",
    );
    expect(
      result.files["__base44_entry.mjs"].indexOf(
        "installStaticEgressFetch()",
      ),
    ).toBeLessThan(
      result.files["__base44_entry.mjs"].indexOf(
        "resolveHandler(functionName)",
      ),
    );
    // Per-app bundles share one script, so the routed function name rides the
    // log context store and the console patch stamps it on every log line.
    expect(result.files["__base44_entry.mjs"]).toContain(
      "fn: functionName ?? ''",
    );
    expect(result.files["__base44_entry.mjs"]).toContain("_b44_function");
    // Background-work hook: request-scoped ctx.waitUntil rides the store.
    expect(result.files["__base44_entry.mjs"]).toContain(
      "waitUntil: (p) => ctx.waitUntil(p)",
    );
    expect(result.files["__base44_entry.mjs"]).toContain("globalThis.Base44");
    // The Worker env binding rides the store so Base44.secrets / base44:runtime
    // secrets.get can read it per-request.
    expect(result.files["__base44_entry.mjs"]).toContain("secrets: env,");
    // Crashes are logged through the patch (attributed) before rethrowing,
    // because CF's own exception event carries no function attribution.
    expect(result.files["__base44_entry.mjs"]).toContain("console.error(e);");
    expect(result.files["__base44_entry.mjs"]).toContain("throw e;");
  });

  it("keys files by the original index so attribution survives excluding a function", () => {
    // A survivor rebuild passes the original index, not its new position.
    const result = prepareApp([
      {
        index: 2,
        fn: { name: "gamma", entry: "main.ts", files: { "main.ts": serve("g") } },
      },
    ]);
    expect(result.files["fn_2/main.ts"]).toContain("g");
    expect(result.files["__base44_fn_2.mjs"]).toContain(
      'import("./fn_2/main.ts")',
    );
  });

  it("rejects reserved injected filenames in a function's input", () => {
    expect(() =>
      prepareApp([
        {
          index: 0,
          fn: {
            name: "a",
            entry: "main.ts",
            files: { "main.ts": serve("ok"), "__base44_entry.mjs": "malicious" },
          },
        },
      ]),
    ).toThrowError(DenoCompatError);
  });

  it("reserves the activation-shim basename at ANY depth per function, in every mode", () => {
    // In the app path each function's files are namespaced under fn_<index>/, so
    // a nested `sub/__base44_activation.mjs` would become
    // `fn_0/sub/__base44_activation.mjs` — it must be rejected up front (in every
    // mode) so it can't pose as the injected shim and reach the PDS manifest store.
    const fn = {
      index: 0,
      fn: {
        name: "a",
        entry: "main.ts",
        files: { "main.ts": serve("ok"), "sub/__base44_activation.mjs": "user file" },
      },
    };
    const err = /Reserved filename "__base44_activation\.mjs"/;
    expect(() => prepareApp([fn])).toThrowError(err);
    expect(() => prepareApp([fn], false, true)).toThrowError(err);
  });

  it("bakes the activation gate before routing only in runtime-secrets mode", () => {
    const fn = { index: 0, fn: { name: "a", entry: "main.ts", files: { "main.ts": serve("a") } } };

    const plain = prepareApp([fn]);
    expect(plain.files["__base44_entry.mjs"]).not.toContain("ensureActivation");
    expect(plain.files["__base44_activation.mjs"]).toBeUndefined();

    const gated = prepareApp([fn], false, true);
    const entry = gated.files["__base44_entry.mjs"];
    expect(gated.files["__base44_activation.mjs"]).toContain("X-Base44-Needs-Activation");
    // Activation gates BEFORE resolveHandler (which imports the user module).
    expect(entry.indexOf("ensureActivation")).toBeLessThan(entry.indexOf("resolveHandler(functionName)"));
    expect(entry).toContain("withoutRuntimeSecretsHeader(request)");
    expect(entry).toContain("withoutActivationSignal(");
  });
});
