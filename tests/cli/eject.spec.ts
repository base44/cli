import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("eject command", () => {
  const t = setupCLITests();

  it("fails when project ID not found", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListProjects([
      { id: "other-project", name: "Other Project", isManagedSourceCode: true },
    ]);

    const result = await t.run(
      "eject",
      "--project-id",
      "non-existent-id",
      "-p",
      "./out"
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found or not ejectable");
  });

  it("fails when project is not ejectable (isManagedSourceCode=false)", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListProjects([
      { id: "test-app-id", name: "Test Project", isManagedSourceCode: false },
    ]);

    const result = await t.run(
      "eject",
      "--project-id",
      "test-app-id",
      "-p",
      "./out"
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found or not ejectable");
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("eject", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(
      "Download the code for an existing Base44 project"
    );
    t.expectResult(result).toContain("--project-id");
    t.expectResult(result).toContain("-p, --path");
  });
});
