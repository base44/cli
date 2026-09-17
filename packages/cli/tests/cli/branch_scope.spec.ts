import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("branch name targeting", () => {
  const t = setupCLITests();
  const appId = "test-app-id";
  const branch = {
    id: "branch-123",
    branch_name: "feature/checkout",
    status: "active",
  };

  it.each([
    "feature/checkout",
    "main",
  ])("resolves %s to the expected sandbox", async (name) => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    let lookups = 0;
    t.api.mockRoute("GET", `/api/apps/${appId}/branches`, (_req, res) => {
      lookups++;
      res.json([branch]);
    });
    t.api.mockRoute(
      "POST",
      `/api/apps/${appId}/sandbox-bridge/list_directory`,
      (req, res) => {
        expect(req.body.branch_id).toBe(
          name === "main" ? undefined : branch.id,
        );
        res.json({ entries: [], truncated: false });
      },
    );
    const result = await t.run(
      "--branch",
      name,
      "sandbox",
      "ls",
      "--app-id",
      appId,
    );
    t.expectResult(result).toSucceed();
    expect(lookups).toBe(name === "main" ? 0 : 1);
  });

  it.each([
    { response: [], error: "was not found" },
    { response: [branch, { ...branch, id: "other" }], error: "ambiguous" },
    {
      response: [{ branch_name: branch.branch_name }],
      error: "Invalid branches response",
    },
  ])("rejects an unresolved name: $error", async ({ response, error }) => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    let writes = 0;
    t.api.mockRoute("GET", `/api/apps/${appId}/branches`, (_req, res) =>
      res.json(response),
    );
    t.api.mockRoute(
      "POST",
      `/api/apps/${appId}/sandbox-bridge/write_file`,
      (_req, res) => {
        writes++;
        res.json({});
      },
    );
    const result = await t.run(
      "sandbox",
      "write",
      "test.txt",
      "--content",
      "test",
      "--branch",
      branch.branch_name,
      "--app-id",
      appId,
      "--json",
    );
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain(error);
    expect(writes).toBe(0);
  });

  it.each([
    { args: ["sandbox", "ls", "--branch", ""], error: "must not be empty" },
    { args: ["functions", "pull", "--branch", "main"], error: "not supported" },
    { args: ["actors", "deploy", "--branch", "main"], error: "not supported" },
    {
      args: ["actors", "delete", "ChatRoom", "--branch", "feature"],
      error: "not supported",
    },
  ])("validates flags before authentication: $error", async ({
    args,
    error,
  }) => {
    const result = await t.run(...args, "--json");
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain(error);
  });
});
