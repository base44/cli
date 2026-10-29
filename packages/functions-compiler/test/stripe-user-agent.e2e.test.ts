import http from "node:http";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { bundleOrThrow } from "./helpers";
import { runInWorkerd } from "./workerd";

it("stripe-node's client user agent leaves workerd without lang_version", async () => {
  const seen: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers["x-stripe-client-user-agent"] as string | undefined);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "echo" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const m = await bundleOrThrow(`
      import Stripe from "npm:stripe@20.4.1";
      Deno.serve(async () => {
        const stripe = new Stripe("sk_test_invalid", { host: "127.0.0.1", port: ${port}, protocol: "http", maxNetworkRetries: 0 });
        try { await stripe.customers.list({ limit: 1 }); } catch (e) { return new Response(e.type); }
        return new Response("unexpected success");
      });
    `);
    const { text } = await runInWorkerd(m);
    expect(text).toBe("StripeAuthenticationError");
    const agent = JSON.parse(seen[0]!);
    expect(agent).not.toHaveProperty("lang_version");
    expect(agent).toMatchObject({ bindings_version: "20.4.1", lang: "node", platform: "linux" });
  } finally {
    server.close();
  }
}, 120_000);
