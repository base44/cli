import { AsyncLocalStorage } from "node:async_hooks";

import { describe, expect, it, vi } from "vitest";

import {
  createRequestScopedStaticEgressFetch,
  STATIC_EGRESS_ARTIFACT_MARKER,
} from "../src/static-egress";

describe("createRequestScopedStaticEgressFetch routing", () => {
  it("routes ordinary fetches through the dedicated network binding", async () => {
    const ordinaryFetch = vi.fn<typeof fetch>();
    const response = new Response("dedicated");
    const bindingFetch = vi.fn().mockResolvedValue(response);
    const routedFetch = createRequestScopedStaticEgressFetch(
      ordinaryFetch,
      () => ({
        STATIC_EGRESS: { fetch: bindingFetch },
        BASE44_STATIC_EGRESS_ENABLED: "1",
      }),
    );

    await expect(routedFetch("https://example.com/orders")).resolves.toBe(
      response,
    );
    expect(bindingFetch).toHaveBeenCalledWith(
      "https://example.com/orders",
      undefined,
    );
    expect(ordinaryFetch).not.toHaveBeenCalled();
  });

  it.each([
    new URL("https://example.com/from-url"),
    new Request("https://example.com/from-request"),
  ])(
    "routes every standard fetch input form through the binding",
    async (input) => {
      const ordinaryFetch = vi.fn<typeof fetch>();
      const response = new Response("dedicated");
      const bindingFetch = vi.fn().mockResolvedValue(response);
      const routedFetch = createRequestScopedStaticEgressFetch(
        ordinaryFetch,
        () => ({
          STATIC_EGRESS: { fetch: bindingFetch },
          BASE44_STATIC_EGRESS_ENABLED: "1",
        }),
      );

      await expect(routedFetch(input)).resolves.toBe(response);
      expect(bindingFetch).toHaveBeenCalledWith(input, undefined);
      expect(ordinaryFetch).not.toHaveBeenCalled();
    },
  );

  it("bypasses dedicated egress for exact hosts and apps-domain subdomains", async () => {
    const response = new Response("ordinary");
    const ordinaryFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const dedicatedResponse = new Response("dedicated");
    const bindingFetch = vi.fn().mockResolvedValue(dedicatedResponse);
    const routedFetch = createRequestScopedStaticEgressFetch(
      ordinaryFetch,
      () => ({
        STATIC_EGRESS: { fetch: bindingFetch },
        BASE44_STATIC_EGRESS_ENABLED: "1",
        BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: JSON.stringify([
          ".base44.app",
          "private.example.com",
        ]),
      }),
    );

    await expect(
      routedFetch("https://BASE44.app./api/apps"),
    ).resolves.toBe(response);
    await expect(
      routedFetch("https://my-app.base44.app/api/apps"),
    ).resolves.toBe(response);
    await expect(
      routedFetch("https://PRIVATE.example.com./health"),
    ).resolves.toBe(response);
    await expect(
      routedFetch("https://customer.example.com/orders"),
    ).resolves.toBe(dedicatedResponse);
    await expect(
      routedFetch("https://notbase44.app/orders"),
    ).resolves.toBe(dedicatedResponse);
    expect(ordinaryFetch).toHaveBeenCalledTimes(3);
    expect(bindingFetch).toHaveBeenCalledTimes(2);
    expect(bindingFetch).toHaveBeenCalledWith(
      "https://customer.example.com/orders",
      undefined,
    );
  });
});

describe("createRequestScopedStaticEgressFetch", () => {
  it("falls back to native fetch when the current request has no binding", async () => {
    const ordinaryResponse = new Response("ordinary");
    const ordinaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ordinaryResponse);
    const routedFetch = createRequestScopedStaticEgressFetch(
      ordinaryFetch,
      () => ({}),
    );

    await expect(
      routedFetch("https://customer.example.com/orders"),
    ).resolves.toBe(ordinaryResponse);
    expect(ordinaryFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent requests isolated to their own Worker environments", async () => {
    const environments = new AsyncLocalStorage<Record<string, unknown>>();
    const ordinaryResponse = new Response("ordinary");
    const ordinaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ordinaryResponse);
    const firstResponse = new Response("first");
    const secondResponse = new Response("second");
    const firstBindingFetch = vi.fn().mockResolvedValue(firstResponse);
    const secondBindingFetch = vi.fn().mockResolvedValue(secondResponse);
    const routedFetch = createRequestScopedStaticEgressFetch(
      ordinaryFetch,
      () => environments.getStore() ?? {},
    );

    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = (
      env: Record<string, unknown>,
      url: string,
    ): Promise<Response> =>
      environments.run(env, async () => {
        await ready;
        return routedFetch(url);
      });

    const responses = Promise.all([
      request(
        {
          STATIC_EGRESS: { fetch: firstBindingFetch },
          BASE44_STATIC_EGRESS_ENABLED: "1",
        },
        "https://first.example.com",
      ),
      request(
        {
          STATIC_EGRESS: { fetch: secondBindingFetch },
          BASE44_STATIC_EGRESS_ENABLED: "1",
        },
        "https://second.example.com",
      ),
      request({}, "https://ordinary.example.com"),
    ]);
    release();

    await expect(responses).resolves.toEqual([
      firstResponse,
      secondResponse,
      ordinaryResponse,
    ]);
    expect(firstBindingFetch).toHaveBeenCalledWith(
      "https://first.example.com",
      undefined,
    );
    expect(secondBindingFetch).toHaveBeenCalledWith(
      "https://second.example.com",
      undefined,
    );
    expect(ordinaryFetch).toHaveBeenCalledWith(
      "https://ordinary.example.com",
      undefined,
    );
  });

  it("defaults off when the binding is attached without an enable secret", async () => {
    const ordinaryResponse = new Response("ordinary");
    const ordinaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ordinaryResponse);
    const dedicatedResponse = new Response("dedicated");
    const bindingFetch = vi.fn().mockResolvedValue(dedicatedResponse);
    const routedFetch = createRequestScopedStaticEgressFetch(
      ordinaryFetch,
      () => ({
        STATIC_EGRESS: { fetch: bindingFetch },
      }),
    );

    await expect(
      routedFetch("https://customer.example.com/orders"),
    ).resolves.toBe(ordinaryResponse);
    expect(bindingFetch).not.toHaveBeenCalled();
    expect(ordinaryFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["0", "", "true", "garbage"])(
    "keeps routing off for an invalid enable secret",
    async (enableSecret) => {
      const ordinaryResponse = new Response("ordinary");
      const ordinaryFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(ordinaryResponse);
      const bindingFetch = vi.fn().mockResolvedValue(new Response("dedicated"));
      const routedFetch = createRequestScopedStaticEgressFetch(
        ordinaryFetch,
        () => ({
          STATIC_EGRESS: { fetch: bindingFetch },
          BASE44_STATIC_EGRESS_ENABLED: enableSecret,
        }),
      );

      await expect(routedFetch("https://customer.example.com")).resolves.toBe(
        ordinaryResponse,
      );
      expect(bindingFetch).not.toHaveBeenCalled();
    },
  );

  it("bypasses dedicated egress for bracketed IPv6 private-source URLs", async () => {
    const ordinaryResponse = new Response("ordinary");
    const ordinaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ordinaryResponse);
    const bindingFetch = vi
      .fn()
      .mockResolvedValue(new Response("dedicated"));
    const routedFetch = createRequestScopedStaticEgressFetch(
      ordinaryFetch,
      () => ({
        STATIC_EGRESS: { fetch: bindingFetch },
        BASE44_STATIC_EGRESS_ENABLED: "1",
        BASE44_PRIVATE_DATA_SOURCES:
          '[{"host":"2001:db8::1"}]',
      }),
    );

    await expect(
      routedFetch("https://[2001:db8::1]/health"),
    ).resolves.toBe(ordinaryResponse);
    expect(ordinaryFetch).toHaveBeenCalledTimes(1);
    expect(bindingFetch).not.toHaveBeenCalled();
  });

  it("logs a bounded fallback decision without the request URL or env value", async () => {
    vi.resetModules();
    const { createRequestScopedStaticEgressFetch: createFreshRoutedFetch } =
      await import("../src/static-egress");
    const ordinaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ordinary"));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const routedFetch = createFreshRoutedFetch(
      ordinaryFetch,
      () => ({
        BASE44_STATIC_EGRESS_EXCLUDED_HOSTS: '["secret.internal.example"]',
      }),
    );

    try {
      await routedFetch("https://customer.example.com/sensitive/path?token=secret");

      const diagnostic = JSON.parse(String(consoleLog.mock.lastCall?.[0]));
      expect(diagnostic).toEqual({
        b44_diagnostic: "static_egress",
        diagnostic_version: STATIC_EGRESS_ARTIFACT_MARKER,
        event: "fetch_route",
        route: "fallback",
        input_kind: "string",
        binding_present: false,
        binding_type: "undefined",
        enable_secret_present: false,
        enable_secret_enabled: false,
        binding_fetch_type: "undefined",
      });
      expect(JSON.stringify(diagnostic)).not.toContain("customer.example.com");
      expect(JSON.stringify(diagnostic)).not.toContain("secret.internal.example");
    } finally {
      consoleLog.mockRestore();
    }
  });
});
