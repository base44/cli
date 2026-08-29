import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("actors delete command", () => {
  const t = setupCLITests();

  it("deletes a single actor successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleActorDelete();

    const result = await t.run("actors", "delete", "ChatRoom");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("deleted");
  });

  it("deletes multiple actors with summary", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleActorDelete();

    const result = await t.run("actors", "delete", "ChatRoom", "BoardRoom");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("ChatRoom deleted");
    t.expectResult(result).toContain("BoardRoom deleted");
    t.expectResult(result).toContain("2/2 deleted");
  });

  it("accepts comma-separated actor names", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleActorDelete();

    const result = await t.run("actors", "delete", "ChatRoom,BoardRoom");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("2/2 deleted");
  });

  it("reports not found for non-existent actor", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleActorDeleteError({
      status: 404,
      body: { error: "Not found" },
    });

    const result = await t.run("actors", "delete", "nonexistent");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("not found");
  });

  it("reports API errors gracefully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleActorDeleteError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("actors", "delete", "ChatRoom");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Failed to delete");
  });

  it("requires at least one actor name", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("actors", "delete", ",");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("At least one actor name is required");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("actors", "delete", "ChatRoom");

    t.expectResult(result).toFail();
  });
});
