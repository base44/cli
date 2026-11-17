import { describe, expect, it, vi } from "vitest";

import { createRetryingFetch } from "../src/dependency-fetch-retry";

const PACKUMENT = "https://registry.npmjs.org/zod";

const retryingOver = (original: () => Promise<Response>) =>
  createRetryingFetch(original as unknown as typeof fetch, [0, 0]);

describe("dependency fetch retry", () => {
  it("retries network errors and 5xx, then gives up with the last answer", async () => {
    const original = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response("", { status: 503 }));

    const res = await retryingOver(original)(PACKUMENT);

    expect(res.status).toBe(503);
    expect(original).toHaveBeenCalledTimes(3);
  });

  it("leaves a 404 and the host's own requests alone", async () => {
    const unavailable = vi.fn(async () => new Response("", { status: 503 }));
    await retryingOver(unavailable)("https://app.base44.com/api/apps");
    await retryingOver(unavailable)(PACKUMENT, { method: "POST" });
    expect(unavailable).toHaveBeenCalledTimes(2);

    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await retryingOver(missing)(PACKUMENT);
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
