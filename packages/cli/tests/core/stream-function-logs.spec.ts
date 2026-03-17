import { beforeEach, describe, expect, it, vi } from "vitest";

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = `${lines.join("\n")}\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockAppClientStream(body: ReadableStream<Uint8Array>) {
  const mockGet = vi.fn().mockResolvedValue({ body });
  vi.doMock("@/core/clients/index.js", () => ({
    getAppClient: () => ({ get: mockGet }),
  }));
  return mockGet;
}

describe("streamFunctionLogs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/core/project/index.js", () => ({
      getAppConfig: () => ({ id: "test-app-id" }),
    }));
  });

  it("yields parsed log entries from SSE data lines", async () => {
    mockAppClientStream(
      sseStream([
        'data: {"time":"2024-01-15T10:30:00Z","level":"info","message":"hello"}',
        "",
        'data: {"time":"2024-01-15T10:30:01Z","level":"error","message":"fail"}',
        "",
      ]),
    );
    const { streamFunctionLogs } = await import(
      "@/core/resources/function/api.js"
    );
    const entries = [];
    for await (const entry of streamFunctionLogs("my-func")) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("hello");
    expect(entries[1].message).toBe("fail");
  });

  it("ignores SSE heartbeat comments", async () => {
    mockAppClientStream(
      sseStream([
        ": heartbeat",
        'data: {"time":"2024-01-15T10:30:00Z","level":"info","message":"only entry"}',
        "",
        ": heartbeat",
      ]),
    );
    const { streamFunctionLogs } = await import(
      "@/core/resources/function/api.js"
    );
    const entries = [];
    for await (const entry of streamFunctionLogs("my-func")) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("only entry");
  });

  it("skips malformed JSON in data lines without throwing", async () => {
    mockAppClientStream(
      sseStream([
        "data: not valid json",
        "",
        'data: {"time":"2024-01-15T10:30:00Z","level":"info","message":"good"}',
        "",
      ]),
    );
    const { streamFunctionLogs } = await import(
      "@/core/resources/function/api.js"
    );
    const entries = [];
    for await (const entry of streamFunctionLogs("my-func")) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("good");
  });

  it("throws ApiError when response body is null", async () => {
    const mockGet = vi.fn().mockResolvedValue({ body: null });
    vi.doMock("@/core/clients/index.js", () => ({
      getAppClient: () => ({ get: mockGet }),
    }));
    const { streamFunctionLogs } = await import(
      "@/core/resources/function/api.js"
    );
    const gen = streamFunctionLogs("my-func");
    await expect(gen.next()).rejects.toThrow(
      "Server returned empty response for log stream",
    );
  });

  it("passes level filter as searchParams", async () => {
    const mockGet = mockAppClientStream(sseStream([]));
    const { streamFunctionLogs } = await import(
      "@/core/resources/function/api.js"
    );
    for await (const _ of streamFunctionLogs("my-func", {
      level: "error",
    })) {
      // empty
    }
    const callArgs = mockGet.mock.calls[0];
    const options = callArgs[1];
    expect(options.searchParams.get("level")).toBe("error");
  });
});
