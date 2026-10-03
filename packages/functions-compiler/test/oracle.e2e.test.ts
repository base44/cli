import { once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";

import { bundleOrThrow } from "./helpers";
import { runInWorkerd, WFP_COMPAT_DATE } from "./workerd";

describe("Oracle Thin in workerd", () => {
  it("bundles and initializes the pinned driver without native libraries", async () => {
    const module = await bundleOrThrow(`
      import oracledb from "npm:oracledb@6.10.0";
      import { oracle } from "base44:private-data-sources/oracle";
      Deno.serve(async () => {
        const options = oracle("Oracle").oracledbOptions();
        try {
          await oracledb.getConnection(options);
          return new Response("unexpected connection");
        } catch (error) {
          return Response.json({ thin: oracledb.thin, message: error.message });
        }
      });
    `);
    const result = await runInWorkerd(module, {
      env: {
        BASE44_PRIVATE_DATA_SOURCES: JSON.stringify([{
          name: "Oracle", type: "oracle", bindingName: "ORACLE",
          host: "oracle.internal", port: 1521, database: "FREEPDB1",
          username: "test", password: "test",
        }]),
        ORACLE: "missing-connect-method",
      },
    });
    expect(result.status).toBe(200);
    const body = JSON.parse(result.text);
    expect(body.thin).toBe(true);
    expect(body.message).toContain('Private data source "Oracle" does not expose connect()');
  });

  it("sends the real driver's Oracle CONNECT packet through a TCP binding", async () => {
    const module = await bundleOrThrow(`
      import oracledb from "npm:oracledb@6.10.0";
      import { oracle } from "base44:private-data-sources/oracle";
      Deno.serve(async () => {
        try {
          await oracledb.getConnection(oracle("Oracle").oracledbOptions());
          return new Response("unexpected connection");
        } catch (error) {
          return new Response(error.message);
        }
      });
    `);
    const packets: Buffer[] = [];
    const tunnelRequests: string[] = [];
    const server = createServer().on("connect", (request, socket) => {
      tunnelRequests.push(request.url!);
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.on("data", (bytes) => {
        packets.push(bytes);
        socket.end();
      });
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test listener");
    const runtime = new Miniflare({
      modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
      compatibilityDate: WFP_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        BASE44_PRIVATE_DATA_SOURCES: JSON.stringify([{
          name: "Oracle", type: "oracle", bindingName: "ORACLE",
          host: "oracle.internal", port: 1521, database: "FREEPDB1",
          username: "test", password: "test",
        }]),
      },
      serviceBindings: { ORACLE: { external: { address: `127.0.0.1:${address.port}`, tcp: {} } } },
    });
    try {
      const response = await runtime.dispatchFetch("http://example.test/");
      expect(await response.text()).not.toBe("unexpected connection");
      const packet = Buffer.concat(packets);
      expect(tunnelRequests).toEqual(["oracle.internal:1521"]);
      expect(packet[4]).toBe(1);
      expect(packet.toString()).toContain("(SERVICE_NAME=FREEPDB1)");
    } finally {
      await runtime.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
