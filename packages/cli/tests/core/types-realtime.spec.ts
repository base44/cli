import { describe, expect, it } from "vitest";
import type { RealtimeHandler } from "@/core/resources/realtime-handler/schema.js";
import { generateContent } from "@/core/types/generator.js";

const EMPTY = {
  projectRoot: "/tmp/does-not-matter", // only read for package.json detect; falls back to @base44/sdk
  entities: [],
  functions: [],
  agents: [],
  connectors: [],
};

function handler(messageSchema: RealtimeHandler["messageSchema"]): RealtimeHandler {
  return {
    name: "GameRoom",
    entry: "entry.ts",
    entryPath: "base44/realtime/GameRoom/entry.ts",
    filePaths: ["base44/realtime/GameRoom/entry.ts"],
    source: { type: "project" },
    messageSchema,
  };
}

describe("realtime handler type generation", () => {
  it("compiles a named-message catalog into a discriminated union with shared types", async () => {
    const out = await generateContent({
      ...EMPTY,
      realtimeHandlers: [
        handler({
          types: {
            Pt: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
              additionalProperties: false,
            },
          },
          toClient: {
            init: {
              properties: { food: { type: "array", items: { $ref: "#/types/Pt" } } },
              required: ["food"],
            },
            died: {
              properties: { id: { type: "string" }, score: { type: "number" } },
              required: ["id", "score"],
            },
          },
          toServer: {
            dir: { properties: { angle: { type: "number" } }, required: ["angle"] },
          },
        }),
      ],
    });

    // `type` discriminant is injected from the message key (author omits it).
    expect(out).toContain('type: "init"');
    expect(out).toContain('type: "died"');
    expect(out).toContain('type: "dir"');
    // Shared type is emitted once, prefixed with the handler name (collision-safe),
    // and referenced by name — not re-inlined.
    expect(out).toContain("export interface GameRoomPt");
    expect(out).toContain("food: GameRoomPt[]");
    // Message interfaces carry their direction (so the same name can appear in both
    // directions); the registry composes the unions from them.
    expect(out).toContain(
      '"GameRoom": { toClient: GameRoomToClientInit | GameRoomToClientDied; toServer: GameRoomToServerDir }',
    );
    // Output is valid TS: no `export interface` spliced inside a type literal
    // (the failure mode of the old regex-based extraction).
    expect(out).not.toMatch(/\{[^}]*export interface/);
  });

  it("throws on a name collision instead of silently clobbering", async () => {
    await expect(
      generateContent({
        ...EMPTY,
        realtimeHandlers: [
          handler({
            // Both keys PascalCase to the same GameRoomToClientUserJoined.
            toClient: {
              "user-joined": { properties: { a: { type: "string" } } },
              userJoined: { properties: { b: { type: "string" } } },
            },
            toServer: {},
          }),
        ],
      }),
    ).rejects.toThrow(/Duplicate generated type "GameRoomToClientUserJoined"/);
  });
});
