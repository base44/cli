import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setRuntimeManifest } from "../src/private-data-sources/runtime-manifest-store";
import { staticEgress } from "../src/runtime/index";
import { runWithWorkerEnvironment } from "../src/runtime-context";
import { installStaticEgressTcp } from "../src/static-egress-tcp";

const target = { hostname: "sftp.example.com", port: 2222 };

function request<T>(env: Record<string, unknown>, action: () => T): T {
  return runWithWorkerEnvironment({ env: "preview", workerEnv: env, secrets: {}, waitUntil() {} }, action);
}

describe("staticEgress.connect", () => {
  beforeEach(() => {
    vi.stubGlobal("Base44", undefined);
    installStaticEgressTcp();
  });
  afterEach(() => {
    setRuntimeManifest(undefined);
    vi.unstubAllGlobals();
  });

  it("opens one dedicated socket and preserves its streams and lifecycle", async () => {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const close = vi.fn().mockResolvedValue(undefined);
    const binding = {
      async connect(address: unknown) {
        expect(this).toBe(binding);
        expect(address).toEqual(target);
        return { readable: stream.readable, writable: stream.writable, opened: Promise.resolve({}), closed: Promise.resolve(), close };
      },
    };
    const socket = await request({ STATIC_EGRESS: binding, BASE44_STATIC_EGRESS_ENABLED: "1" }, () => staticEgress.connect(target, { secureTransport: "off" }));
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    const bytes = new TextEncoder().encode("SSH-2.0-test\r\n");
    await Promise.all([writer.write(bytes), expect(reader.read()).resolves.toEqual({ value: bytes, done: false })]);
    reader.releaseLock();
    writer.releaseLock();
    await socket.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ["1.1.1.1", "1.1.1.1"],
    ["[2606:4700::1111]", "2606:4700::1111"],
    ["SFTP.EXAMPLE.COM.", "sftp.example.com"],
  ])("accepts and normalizes public destination %s", async (hostname, normalized) => {
    const connect = vi.fn().mockResolvedValue({});
    await request({
      STATIC_EGRESS: { connect },
      BASE44_STATIC_EGRESS_ENABLED: "1",
    }, () => staticEgress.connect({ hostname, port: 2222 }));
    expect(connect).toHaveBeenCalledExactlyOnceWith({ hostname: normalized, port: 2222 });
  });

  it.each([undefined, "0", "true", true, 1])("rejects disabled configuration %s without opening a socket", async (enabled) => {
    const connect = vi.fn();
    await expect(request({ STATIC_EGRESS: { connect }, BASE44_STATIC_EGRESS_ENABLED: enabled }, () => staticEgress.connect(target))).rejects.toThrow(/not enabled/);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { fetch: vi.fn() }])("rejects an unavailable TCP binding", async (binding) => {
    await expect(request({ STATIC_EGRESS: binding, BASE44_STATIC_EGRESS_ENABLED: "1" }, () => staticEgress.connect(target))).rejects.toThrow(/binding is unavailable/);
  });

  it("rejects calls outside an invocation", async () => {
    await expect(staticEgress.connect(target)).rejects.toThrow(/active server request/);
  });

  it.each(["on", "starttls", "unexpected", null])("rejects unsupported TLS mode %s before connecting", async (secureTransport) => {
    const connect = vi.fn();
    await expect(request({ STATIC_EGRESS: { connect }, BASE44_STATIC_EGRESS_ENABLED: "1" }, () => staticEgress.connect(target, { secureTransport } as never))).rejects.toThrow(/TLS and STARTTLS are not supported/);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([null, [], { allowHalfOpen: true }])("rejects invalid or unknown options before connecting", async (options) => {
    const connect = vi.fn();
    await expect(request({
      STATIC_EGRESS: { connect },
      BASE44_STATIC_EGRESS_ENABLED: "1",
    }, () => staticEgress.connect(target, options as never))).rejects.toThrow(TypeError);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    { hostname: "https://sftp.example.com", port: 2222 },
    { hostname: "sftp.example.com:2222", port: 2222 },
    { hostname: "[2606:4700::1111]:80", port: 2222 },
    { hostname: "user@sftp.example.com", port: 2222 },
    { hostname: "sftp.example.com/path", port: 2222 },
    { hostname: "", port: 2222 },
    { hostname: "sftp.example.com", port: "2222" },
    { hostname: "sftp.example.com", port: 0 },
    { hostname: "sftp.example.com", port: 65536 },
    { hostname: "sftp.example.com", port: 22.5 },
  ])("rejects invalid address $hostname:$port", async (address) => {
    const connect = vi.fn();
    await expect(request({ STATIC_EGRESS: { connect }, BASE44_STATIC_EGRESS_ENABLED: "1" }, () => staticEgress.connect(address as never))).rejects.toThrow(TypeError);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(["localhost", "127.1", "0x7f000001", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "[::1]", "::ffff:127.0.0.1", "fc00::1", "db.internal", "BASE44.APP.", "app.base44.app", "PRIVATE.example.com."])("rejects private or excluded destination %s", async (hostname) => {
    const connect = vi.fn();
    const env = { STATIC_EGRESS: { connect }, BASE44_STATIC_EGRESS_ENABLED: "1", BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: '[".base44.app"]', BASE44_PRIVATE_DATA_SOURCES: '[{"host":"private.example.com"}]' };
    await expect(request(env, () => staticEgress.connect({ hostname, port: 2222 }))).rejects.toThrow(/not allowed/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("honors the activation-delivered PDS manifest without exposing it", async () => {
    setRuntimeManifest('[{"host":"sftp.example.com","password":"fixture-only"}]');
    const connect = vi.fn();
    await expect(request({ STATIC_EGRESS: { connect }, BASE44_STATIC_EGRESS_ENABLED: "1" }, () => staticEgress.connect(target))).rejects.toThrow(/not allowed/);
    expect(connect).not.toHaveBeenCalled();
    expect(JSON.stringify((globalThis as any).Base44)).not.toContain("fixture-only");
  });

  it("treats an empty activation manifest as authoritative over a stale binding", async () => {
    setRuntimeManifest("");
    const connect = vi.fn().mockResolvedValue({});
    await request({
      STATIC_EGRESS: { connect },
      BASE44_STATIC_EGRESS_ENABLED: "1",
      BASE44_PRIVATE_DATA_SOURCES: '[{"host":"sftp.example.com"}]',
    }, () => staticEgress.connect(target));
    expect(connect).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("rejects malformed restriction configuration", async () => {
    const connect = vi.fn();
    await expect(request({ STATIC_EGRESS: { connect }, BASE44_STATIC_EGRESS_ENABLED: "1", BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: "broken" }, () => staticEgress.connect(target))).rejects.toThrow(/restrictions are unavailable/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("propagates connection failures without trying another transport", async () => {
    const error = new Error("connection refused");
    const connect = vi.fn().mockRejectedValue(error);
    await expect(request({ STATIC_EGRESS: { connect }, BASE44_STATIC_EGRESS_ENABLED: "1" }, () => staticEgress.connect(target))).rejects.toBe(error);
    expect(connect).toHaveBeenCalledOnce();
  });

  it("keeps concurrent requests isolated and checks the enable flag for every new socket", async () => {
    const first = vi.fn().mockResolvedValue({});
    const second = vi.fn().mockResolvedValue({});
    const env = { STATIC_EGRESS: { connect: first }, BASE44_STATIC_EGRESS_ENABLED: "1" };
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const pending = request(env, async () => { await paused; await staticEgress.connect(target); });
    await request({ STATIC_EGRESS: { connect: second }, BASE44_STATIC_EGRESS_ENABLED: "1" }, () => staticEgress.connect(target));
    release();
    await pending;
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    env.BASE44_STATIC_EGRESS_ENABLED = "0";
    await expect(request(env, () => staticEgress.connect(target))).rejects.toThrow(/not enabled/);
    expect(first).toHaveBeenCalledOnce();
  });
});
