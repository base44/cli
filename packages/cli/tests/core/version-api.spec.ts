import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvironmentVersion } from "../../src/core/version/api.js";

const mockPatch = vi.fn();
vi.mock("../../src/core/clients/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/core/clients/index.js")>();
  return {
    ...actual,
    getAppClient: () => ({ patch: mockPatch }),
  };
});

function answered(body: unknown) {
  return { json: async () => body };
}

const DEPLOYED = {
  name: "production",
  version_id: "ver-1",
  manifest_hash: "sha256:abc",
  deployment_id: "dep-1",
};

describe("setEnvironmentVersion", () => {
  beforeEach(() => {
    mockPatch.mockReset();
    mockPatch.mockResolvedValue(answered(DEPLOYED));
  });

  it("retries the request when an idempotency key makes a repeat the same call", async () => {
    // A lost response is otherwise a failed command over a publication the
    // server already committed. The key is what turns a repeat into a replay:
    // the server answers it with the deployment it already made.
    await setEnvironmentVersion("production", "ver-1", {
      idempotencyKey: "key-1",
    });

    const [, options] = mockPatch.mock.calls[0];
    expect(options.retry).toMatchObject({ limit: 3, methods: ["patch"] });
  });

  it("does not retry without one, because a repeat is a second publish", async () => {
    // Which is exactly what a deliberate redeploy is — so retrying a keyless
    // call would turn one dropped packet into two publications.
    await setEnvironmentVersion("production", "ver-1");

    const [, options] = mockPatch.mock.calls[0];
    expect(options.retry).toBeUndefined();
  });

  it("sends the key so the server can recognise the replay", async () => {
    await setEnvironmentVersion("production", "ver-1", {
      idempotencyKey: "key-1",
    });

    const [, options] = mockPatch.mock.calls[0];
    expect(options.json).toMatchObject({
      version_id: "ver-1",
      idempotency_key: "key-1",
    });
  });
});
