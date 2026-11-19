import { describe, expect, it, vi } from "vitest";

import { createPlatformFetch } from "../src/platform-fetch";
import { createRequestScopedStaticEgressFetch } from "../src/static-egress";

function routed(env: Record<string, unknown> = {}) {
  const ordinaryFetch = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("ordinary"));
  const platformBindingFetch = vi
    .fn()
    .mockImplementation(async () => new Response("platform"));
  const routedFetch = createPlatformFetch(ordinaryFetch, () => ({
    BASE44_PLATFORM_FETCH: { fetch: platformBindingFetch },
    ...env,
  }));
  return { routedFetch, ordinaryFetch, platformBindingFetch };
}

const URL_BIN = "https://bucket.example.com/file.bin";

describe("createPlatformFetch", () => {
  it.each<[string, RequestInfo | URL, RequestInit | undefined]>([
    ["a HEAD in init", URL_BIN, { method: "HEAD" }],
    ["a lower-case head", new URL(URL_BIN), { method: "head" }],
    ["a HEAD Request", new Request(URL_BIN, { method: "HEAD" }), undefined],
    ["a Range header in init", URL_BIN, { headers: { Range: "bytes=0-9" } }],
    [
      "a Range header on the Request",
      new Request(URL_BIN, { headers: { range: "bytes=0-9" } }),
      undefined,
    ],
    ["cache no-store in init", URL_BIN, { cache: "no-store" }],
    [
      "cache no-store on the Request",
      new Request(URL_BIN, { cache: "no-store" }),
      undefined,
    ],
  ])("sends %s to the platform binding", async (_, input, init) => {
    const { routedFetch, ordinaryFetch, platformBindingFetch } = routed();

    expect(await (await routedFetch(input, init)).text()).toBe("platform");
    expect(platformBindingFetch).toHaveBeenCalledWith(input, init);
    expect(ordinaryFetch).not.toHaveBeenCalled();
  });

  it.each<[string, RequestInfo | URL, RequestInit | undefined]>([
    ["a plain GET", URL_BIN, undefined],
    ["a POST", URL_BIN, { method: "POST", body: "x" }],
    ["init headers that replace a ranged Request's", new Request(URL_BIN, { headers: { Range: "bytes=0-9" } }), { headers: { Accept: "*/*" } }],
    ["an init method that replaces a HEAD Request's", new Request(URL_BIN, { method: "HEAD" }), { method: "GET" }],
  ])("keeps %s on the global fetch", async (_, input, init) => {
    const { routedFetch, ordinaryFetch, platformBindingFetch } = routed();

    expect(await (await routedFetch(input, init)).text()).toBe("ordinary");
    expect(ordinaryFetch).toHaveBeenCalledWith(input, init);
    expect(platformBindingFetch).not.toHaveBeenCalled();
  });

  it("uses the global fetch when the Worker has no platform binding", async () => {
    const ordinaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ordinary"));
    const routedFetch = createPlatformFetch(ordinaryFetch, () => ({}));

    await routedFetch(URL_BIN, { method: "HEAD" });
    expect(ordinaryFetch).toHaveBeenCalledWith(URL_BIN, { method: "HEAD" });
  });

  it("leaves malformed headers for the global fetch to reject", async () => {
    const { routedFetch, ordinaryFetch, platformBindingFetch } = routed();
    const init = { headers: { "bad header": "x" } };

    await routedFetch(URL_BIN, init);
    expect(ordinaryFetch).toHaveBeenCalledWith(URL_BIN, init);
    expect(platformBindingFetch).not.toHaveBeenCalled();
  });

  it("leaves dedicated static egress in charge of the requests it takes", async () => {
    const { routedFetch: platformFetch, platformBindingFetch } = routed();
    const egressFetch = vi.fn().mockResolvedValue(new Response("dedicated"));
    const outbound = createRequestScopedStaticEgressFetch(platformFetch, () => ({
      STATIC_EGRESS: { fetch: egressFetch },
      BASE44_STATIC_EGRESS_ENABLED: "1",
      BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: JSON.stringify([".base44.app"]),
    }));

    expect(await (await outbound(URL_BIN, { method: "HEAD" })).text()).toBe(
      "dedicated",
    );
    expect(
      await (
        await outbound("https://my-app.base44.app/file.bin", { method: "HEAD" })
      ).text(),
    ).toBe("platform");
    expect(egressFetch).toHaveBeenCalledTimes(1);
    expect(platformBindingFetch).toHaveBeenCalledTimes(1);
  });
});
