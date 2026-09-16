import { describe, expect, it } from "vitest";
import { requireApp } from "@/cli/utils/command/middleware.js";
import { InternalError } from "@/core/errors.js";

describe("requireApp", () => {
  it("hands back the app the lifecycle resolved", () => {
    expect(requireApp({ app: { id: "app-1" } }).id).toBe("app-1");
  });

  it("raises rather than letting a command run without one", () => {
    // Unreachable for a command that did not opt out of app context — which is
    // the point: the alternative was defaulting the id to "", and Vite inlines
    // that into a dist whose SDK addresses no app, with nothing failing.
    expect(() => requireApp({ app: undefined })).toThrow(InternalError);
  });
});
