import { describe, expect, it } from "vitest";
import { ApiError, stepOf } from "@/core/errors.js";
import { tagStep } from "@/core/version/publish.js";

describe("which step a publish broke in", () => {
  it("carries the step out with the failure", async () => {
    // A user's build failing, an artifact set the platform refused and a lost
    // publication race are three incidents with three responses. One exit code
    // for all of them is how a sandbox log stops being diagnostic.
    await tagStep("create_version", () =>
      Promise.reject(new ApiError("rejected", { statusCode: 400 })),
    ).catch((error) => {
      expect(error.message).toBe("rejected");
      expect(stepOf(error)).toBe("create_version");
    });
  });

  it("tags a callback that throws synchronously too", async () => {
    await tagStep("build", () => {
      throw new Error("the build command exited 1");
    }).catch((error) => {
      expect(stepOf(error)).toBe("build");
    });
  });

  it("leaves the error otherwise untouched", async () => {
    // Wrapping it would cost the envelope the status and request id a caller
    // needs to look the failure up server-side.
    const original = new ApiError("upstream said no", {
      statusCode: 502,
      requestId: "req-1",
    });

    await tagStep("deploy", () => Promise.reject(original)).catch((error) => {
      expect(error).toBe(original);
      expect(error.statusCode).toBe(502);
      expect(error.requestId).toBe("req-1");
    });
  });

  it("keeps the innermost step when steps nest", async () => {
    await tagStep("deploy", () =>
      tagStep("create_version", () => Promise.reject(new Error("inner"))),
    ).catch((error) => {
      expect(stepOf(error)).toBe("create_version");
    });
  });

  it("reports no step for a failure that never passed through one", () => {
    expect(stepOf(new Error("unrelated"))).toBeUndefined();
  });
});

describe("an error the step cannot be attached to", () => {
  it("survives a frozen error rather than replacing it", async () => {
    // A library that freezes its errors would otherwise turn the tag into a
    // TypeError, losing the message, status and request id entirely.
    const frozen = Object.freeze(new ApiError("frozen", { statusCode: 418 }));

    await expect(tagStep("deploy", () => Promise.reject(frozen))).rejects.toBe(
      frozen,
    );
    expect(stepOf(frozen)).toBeUndefined();
  });
});
