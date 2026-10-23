import { expect, it } from "vitest";

import { bundleOrThrow } from "./helpers";
import { runInWorkerd } from "./workerd";

it("reports the patched Node version to user code", async () => {
  const m = await bundleOrThrow(`
    const atImport = process.version;
    Deno.serve(() => Response.json({ atImport, atRequest: process.version }));
  `);
  const { status, text } = await runInWorkerd(m);
  expect(status).toBe(200);
  expect(JSON.parse(text)).toEqual({ atImport: "v22.23.4", atRequest: "v22.23.4" });
});
