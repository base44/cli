/**
 * Manifest resolution source. Runtime-secrets bundles receive
 * BASE44_PRIVATE_DATA_SOURCES through the private, single-instance
 * runtime-manifest store the activation shim writes (not a global, not
 * process.env — see runtime-manifest-store.ts); old-mode bundles read the
 * immutable `cloudflare:workers` binding. The lookup must:
 *   - prefer the store-delivered manifest, else fall back to the binding;
 *   - NEVER trust process.env (user code can write it) for the manifest;
 *   - re-parse when the raw manifest changes (rotation re-delivery);
 *   - pin a handshake-delivered manifest to the DEPLOYED binding set (a fresh
 *     manifest must not surface a source whose Hyperdrive/VPC binding this
 *     frozen script lacks).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// manifest.ts reads the Worker env via workerEnvironment() (the request-scoped
// runtime context), so mock that module rather than the raw cloudflare:workers
// binding. currentWorkerRuntimeContext() is truthy — we're "in a request".
const mockCfEnv = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock("../src/private-data-sources/runtime-environment", () => ({
  workerEnvironment: () => mockCfEnv,
  currentWorkerRuntimeContext: () => ({}),
}));

import { lookupPrivateDataSource } from "../src/private-data-sources/manifest";
import {
  getRuntimeManifest,
  setRuntimeManifest,
} from "../src/private-data-sources/runtime-manifest-store";

const MANIFEST_ENV = "BASE44_PRIVATE_DATA_SOURCES";

const entry = (name: string) => ({
  name,
  type: "postgres",
  bindingName: `DATA_SOURCE_${name.toUpperCase()}_ABC123`,
  bindingKind: "vpc_service",
  host: "10.0.0.1",
  port: 5432,
  database: "db",
  username: "u",
  password: "hunter2",
});

function bindLive(name: string) {
  // The live VPC/Hyperdrive handle the script was uploaded with.
  mockCfEnv[entry(name).bindingName] = { __handle: name };
}

// The activation shim writes the manifest into the private store; manifest.ts
// reads it from the same module. Here we write it directly (unit context).
function deliverViaHandshake(json: string | undefined) {
  setRuntimeManifest(json);
}

afterEach(() => {
  delete process.env[MANIFEST_ENV];
  setRuntimeManifest(undefined);
  for (const key of Object.keys(mockCfEnv)) delete mockCfEnv[key];
});

describe("private data source manifest resolution", () => {
  it("resolves a handshake-delivered manifest from the private store", () => {
    bindLive("pg");
    deliverViaHandshake(JSON.stringify([entry("pg")]));

    expect(lookupPrivateDataSource("pg", "postgres").password).toBe("hunter2");
    expect(getRuntimeManifest()).toContain("hunter2"); // store holds it, not a global
  });

  it("falls back to the cloudflare:workers binding in old mode", () => {
    bindLive("legacy");
    mockCfEnv[MANIFEST_ENV] = JSON.stringify([entry("legacy")]);

    expect(lookupPrivateDataSource("legacy", "postgres").bindingName).toBe(
      "DATA_SOURCE_LEGACY_ABC123",
    );
  });

  it("ignores a manifest forged in process.env (user code cannot spoof it)", () => {
    // User code sets process.env[MANIFEST_ENV] to retarget a source; the real
    // manifest comes only from the private store / binding.
    bindLive("real");
    deliverViaHandshake(JSON.stringify([entry("real")]));
    process.env[MANIFEST_ENV] = JSON.stringify([
      { ...entry("real"), host: "attacker.internal" },
    ]);

    expect(lookupPrivateDataSource("real", "postgres").host).toBe("10.0.0.1");
  });

  it("ignores process.env entirely when no manifest is delivered", () => {
    bindLive("evil");
    process.env[MANIFEST_ENV] = JSON.stringify([entry("evil")]);

    expect(() => lookupPrivateDataSource("evil")).toThrowError(/not bound/);
  });

  it("re-reads the manifest when the raw value changes (rotation re-delivery)", () => {
    bindLive("first");
    bindLive("second");
    deliverViaHandshake(JSON.stringify([entry("first")]));
    expect(lookupPrivateDataSource("first").name).toBe("first");

    deliverViaHandshake(JSON.stringify([entry("second")]));
    expect(lookupPrivateDataSource("second").name).toBe("second");
    expect(() => lookupPrivateDataSource("first")).toThrowError(/not bound/);
  });

  it("drops entries whose binding this script was not deployed with", () => {
    // A source added after this script's upload arrives in a fresh manifest
    // but its live binding is frozen out — the entry must not resolve.
    bindLive("deployed");
    deliverViaHandshake(JSON.stringify([entry("deployed"), entry("added_later")]));

    expect(lookupPrivateDataSource("deployed").name).toBe("deployed");
    expect(() => lookupPrivateDataSource("added_later")).toThrowError(/not bound/);
  });

  it("throws for a source missing from the manifest", () => {
    bindLive("pg");
    deliverViaHandshake(JSON.stringify([entry("pg")]));

    expect(() => lookupPrivateDataSource("nope")).toThrowError(/not bound/);
  });
});
