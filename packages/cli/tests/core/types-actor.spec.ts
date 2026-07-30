import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getActorRuntimeTypesPath, getTypesOutputPath } from "@/core/config.js";
import type { Actor } from "@/core/resources/actor/schema.js";
import { generateContent, generateTypesFile } from "@/core/types/generator.js";

const EMPTY = {
  projectRoot: "/tmp/does-not-matter", // only read for package.json detect; falls back to @base44/sdk
  entities: [],
  functions: [],
  agents: [],
  connectors: [],
};

function actor(messageSchema: Actor["messageSchema"]): Actor {
  return {
    name: "GameRoom",
    entry: "entry.ts",
    entryPath: "base44/actors/GameRoom/entry.ts",
    filePaths: ["base44/actors/GameRoom/entry.ts"],
    source: { type: "project" },
    messageSchema,
  };
}

describe("actor type generation", () => {
  it("compiles a named-message catalog into a discriminated union with shared types", async () => {
    const out = await generateContent({
      ...EMPTY,
      actors: [
        actor({
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
              properties: {
                food: { type: "array", items: { $ref: "#/types/Pt" } },
              },
              required: ["food"],
            },
            died: {
              properties: { id: { type: "string" }, score: { type: "number" } },
              required: ["id", "score"],
            },
          },
          toServer: {
            dir: {
              properties: { angle: { type: "number" } },
              required: ["angle"],
            },
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
    // The base44:runtime/actors virtual module is emitted into a SEPARATE ambient
    // file (see the next test), never into this module-scoped output — here it
    // would be a failed augmentation and the import would not resolve.
    expect(out).not.toContain("base44:runtime/actors");
    // Output is valid TS: no `export interface` spliced inside a type literal
    // (the failure mode of the old regex-based extraction).
    expect(out).not.toMatch(/\{[^}]*export interface/);
  });

  it("emits base44:runtime/actors as an ambient .d.ts (not the module-scoped types.d.ts)", async () => {
    const root = await mkdtemp(join(tmpdir(), "b44-types-"));
    try {
      await generateTypesFile({
        ...EMPTY,
        projectRoot: root,
        actors: [actor(undefined)],
      });
      const runtime = await readFile(getActorRuntimeTypesPath(root), "utf8");
      const types = await readFile(getTypesOutputPath(root), "utf8");

      // The ambient module lives in its own script-context file...
      expect(runtime).toContain("declare module 'base44:runtime/actors'");
      expect(runtime).toContain("export { Actor } from '@base44/sdk'");
      // ...with no top-level export, so it stays an ambient declaration.
      expect(runtime).not.toMatch(/^export \{\};/m);
      // ...and it must NOT appear in the module-scoped types.d.ts.
      expect(types).not.toContain("base44:runtime/actors");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("throws on a name collision instead of silently clobbering", async () => {
    await expect(
      generateContent({
        ...EMPTY,
        actors: [
          actor({
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
