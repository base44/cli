import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("branches list", () => {
  const t = setupCLITests();

  it.each([
    [],
    [{ id: "b1", branch_name: "feature/checkout", status: "active" }],
  ])("returns usable names including main without needing a project", async (...rows) => {
    const branches = rows.flat();
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.json(branches),
    );
    const result = await t.run(
      "branches",
      "list",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      branches: [
        { name: "main", status: "active" },
        ...branches.map((b) => ({ name: b.branch_name, status: b.status })),
      ],
    });
  });

  it("does not invent a main-only result when access fails", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.status(403).json({ detail: "Denied" }),
    );
    const result = await t.run(
      "branches",
      "list",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout)).not.toHaveProperty("branches");
  });
});
