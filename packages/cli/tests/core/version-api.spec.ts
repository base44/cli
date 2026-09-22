import ky from "ky";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvironmentVersion } from "../../src/core/version/api.js";

/**
 * A real ky client over a fake network, so these exercise ky's own retry loop
 * rather than asserting the options we handed it. Configuration that reads
 * correctly and retries nothing is exactly the bug under test.
 */
const fakeFetch = vi.fn();
vi.mock("../../src/core/clients/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/core/clients/index.js")>();
  return {
    ...actual,
    getAppClient: () =>
      ky.create({
        prefixUrl: "https://api.test/api/apps/app-1/",
        fetch: (...args: unknown[]) => fakeFetch(...args),
      }),
  };
});

const DEPLOYED = {
  name: "production",
  version_id: "ver-1",
  manifest_hash: "sha256:abc",
  deployment_id: "dep-1",
};

function committed(): Response {
  return new Response(JSON.stringify(DEPLOYED), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function unavailable(): Response {
  return new Response("", { status: 503 });
}

/** What ky raises when OUR deadline expires — which says nothing about the server. */
function clientTimeout(): Error {
  const error = new Error("Request timed out");
  error.name = "TimeoutError";
  return error;
}

/** Read as each call is made: by assertion time the request body is consumed. */
const bodiesSent: unknown[] = [];
let plan: Array<() => Response | Error> = [];

/** What the network answers, in order. The last entry answers every call after. */
function answers(...entries: Array<() => Response | Error>): void {
  plan = entries;
}

describe("setEnvironmentVersion", () => {
  beforeEach(() => {
    fakeFetch.mockReset();
    bodiesSent.length = 0;
    plan = [committed];
    fakeFetch.mockImplementation(async (request: Request) => {
      bodiesSent.push(await request.clone().json());
      const answer = (plan.length > 1 ? plan.shift() : plan[0]) as () =>
        | Response
        | Error;
      const result = answer();
      if (result instanceof Error) {
        throw result;
      }
      return result;
    });
  });

  it("replays a keyed deploy whose response never arrived", async () => {
    // The case the key exists for: the server may well have committed, so the
    // second attempt is answered from the publication it already made rather
    // than making a second one.
    answers(clientTimeout, committed);

    const answer = await setEnvironmentVersion("production", "ver-1", {
      idempotencyKey: "key-1",
    });

    expect(answer.deploymentId).toBe("dep-1");
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("replays it with the same key, or the replay is a second publish", async () => {
    answers(clientTimeout, committed);

    await setEnvironmentVersion("production", "ver-1", {
      idempotencyKey: "key-1",
    });

    expect(bodiesSent[0]).toEqual({
      version_id: "ver-1",
      idempotency_key: "key-1",
    });
    expect(bodiesSent[1]).toEqual(bodiesSent[0]);
  });

  it("replays a keyed deploy the server failed to answer", async () => {
    answers(unavailable, committed);

    const answer = await setEnvironmentVersion("production", "ver-1", {
      idempotencyKey: "key-1",
    });

    expect(answer.deploymentId).toBe("dep-1");
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("does not replay without a key, because a repeat is a second publish", async () => {
    // Which is exactly what a deliberate redeploy is — so a dropped packet must
    // not quietly become two publications.
    answers(clientTimeout);

    await expect(
      setEnvironmentVersion("production", "ver-1"),
    ).rejects.toThrow();
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than replaying forever", async () => {
    answers(clientTimeout);

    await expect(
      setEnvironmentVersion("production", "ver-1", { idempotencyKey: "key-1" }),
    ).rejects.toThrow();
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });
});
