import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllActors } from "@/core/resources/actor/config.js";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");
const fwd = (path: string) => path.replace(/\\/g, "/");

describe("readAllActors", () => {
  it("returns an empty array when the actors directory does not exist", async () => {
    const actors = await readAllActors(
      resolve(FIXTURES_DIR, "nonexistent-actors"),
    );

    expect(actors).toEqual([]);
  });

  it("discovers actors and skips folders whose name contains a dot", async () => {
    const actors = await readAllActors(
      resolve(FIXTURES_DIR, "actor-discovery"),
    );

    // Chat.Room/ is present in the fixture but can never be a valid actor name,
    // so it is excluded rather than deployed into a server-side rejection.
    expect(actors.map((actor) => actor.name)).toEqual(["BoardRoom"]);
  });

  it("collects actor files recursively", async () => {
    const actors = await readAllActors(
      resolve(FIXTURES_DIR, "actor-discovery"),
    );
    const boardRoom = actors.find((actor) => actor.name === "BoardRoom");

    expect(boardRoom).toBeDefined();
    expect(boardRoom!.entry).toBe("entry.ts");
    expect(boardRoom!.filePaths.map(fwd).sort()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/BoardRoom\/entry\.ts$/),
        expect.stringMatching(/BoardRoom\/lib\/helper\.ts$/),
      ]),
    );
  });

  it("rejects an entry file directly under the actors root", async () => {
    const actorsDir = resolve(FIXTURES_DIR, "actor-discovery-entry-at-root");

    await expect(readAllActors(actorsDir)).rejects.toThrow(
      /entry\.js found directly in the actors directory/,
    );
  });

  it("rejects a nested actor folder", async () => {
    const actorsDir = resolve(FIXTURES_DIR, "actor-invalid-nested");

    await expect(readAllActors(actorsDir)).rejects.toThrow(
      /Invalid actor name "games\/Arena" — actors cannot be nested/,
    );
  });

  it("rejects a helper file named entry.ts inside an actor folder", async () => {
    const actorsDir = resolve(FIXTURES_DIR, "actor-invalid-helper-entry");

    // The failure mode the nesting error's second hint covers.
    await expect(readAllActors(actorsDir)).rejects.toThrow(
      /Invalid actor name "BoardRoom\/lib" — actors cannot be nested/,
    );
  });

  it("rejects an actor name that is not a JavaScript identifier", async () => {
    const actorsDir = resolve(FIXTURES_DIR, "actor-invalid-charset");

    await expect(readAllActors(actorsDir)).rejects.toThrow(
      /Invalid actor name "chat-room" — actor names become a JavaScript class binding/,
    );
  });

  it("rejects an actor name that is a JavaScript reserved word", async () => {
    const actorsDir = resolve(FIXTURES_DIR, "actor-invalid-reserved");

    await expect(readAllActors(actorsDir)).rejects.toThrow(
      /Invalid actor name "class" — it is a reserved word in JavaScript/,
    );
  });

  it("rejects folders containing both entry.js and entry.ts", async () => {
    const actorsDir = resolve(
      FIXTURES_DIR,
      "duplicate-actor-names/base44/actors",
    );

    await expect(readAllActors(actorsDir)).rejects.toThrow(
      /Duplicate actor name "Duplicate"/,
    );
  });
});
