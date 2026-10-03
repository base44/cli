import { describe, expect, it } from "vitest";
import { versionsApiEnabled } from "@/core/version/gate.js";

describe("versionsApiEnabled", () => {
  it("is off unless the env var says otherwise", () => {
    expect(versionsApiEnabled({})).toBe(false);
    expect(versionsApiEnabled({ BASE44_VERSIONS_API: "" })).toBe(false);
    expect(versionsApiEnabled({ BASE44_VERSIONS_API: "0" })).toBe(false);
    expect(versionsApiEnabled({ BASE44_VERSIONS_API: "yes" })).toBe(false);
  });

  it("takes the same two values the deployments gate takes", () => {
    expect(versionsApiEnabled({ BASE44_VERSIONS_API: "1" })).toBe(true);
    expect(versionsApiEnabled({ BASE44_VERSIONS_API: "true" })).toBe(true);
  });

  it("is a separate switch from the deployments lane", () => {
    // One var switching both would make them impossible to roll out apart, and
    // the build sandbox already sets BASE44_DEPLOYMENTS_API for the legacy arm.
    expect(versionsApiEnabled({ BASE44_DEPLOYMENTS_API: "1" })).toBe(false);
  });
});
