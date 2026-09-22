import { basename, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectConfig } from "@/core/project/config.js";
import { readAllActors } from "@/core/resources/actor/config.js";
import { ActorNameSchema } from "@/core/resources/actor/schema.js";

const fixtures = resolve(__dirname, "../fixtures");
const actorDir = join(fixtures, "with-actors/base44/actors");

describe("actor discovery", () => {
  it("reads TS and JS actors with folder-local source and config files", async () => {
    const actors = await readAllActors(actorDir);
    expect(
      actors.map(({ name, entry, source }) => ({ name, entry, source })),
    ).toEqual([
      { name: "ChatRoom", entry: "entry.ts", source: { type: "project" } },
      { name: "Counter", entry: "entry.js", source: { type: "project" } },
    ]);
    expect(
      actors[0].filePaths.map((path) =>
        relative(join(actorDir, "ChatRoom"), path)
          .split(/[/\\\\]/)
          .join("/"),
      ),
    ).toEqual(["data.json", "deno.jsonc", "entry.ts", "lib/message.ts"]);
  });

  it("returns no actors when the directory is absent", async () => {
    expect(await readAllActors(join(fixtures, "basic/base44/actors"))).toEqual(
      [],
    );
  });

  it.each([
    ["root", "named subfolder"],
    ["nested", "cannot be nested"],
    ["duplicate", "Duplicate actor name"],
    ["invalid", "Invalid actor name"],
    ["reserved", "Invalid actor name"],
  ])("rejects %s entries", async (name, error) => {
    await expect(
      readAllActors(join(fixtures, "actor-validation", name)),
    ).rejects.toThrow(error);
  });

  it.each([
    "",
    "1Room",
    "Room/Child",
    "Room-Name",
    "class",
    "eval",
    "arguments",
    "await",
    "Room\n",
    "a".repeat(129),
  ])("rejects invalid name %j", (name) => {
    expect(ActorNameSchema.safeParse(name).success).toBe(false);
  });

  it.each(["Room", "_Room2", "a".repeat(128)])("accepts name %s", (name) => {
    expect(ActorNameSchema.safeParse(name).success).toBe(true);
  });
});

describe("actors in project resources", () => {
  it("keeps old projects compatible", async () => {
    const data = await readProjectConfig(join(fixtures, "basic"));
    expect(data.project.actorsDir).toBe("actors");
    expect(data.actors).toEqual([]);
  });

  it("loads folder names from the project", async () => {
    const data = await readProjectConfig(join(fixtures, "with-actors"));
    expect(data.actors.map((actor) => basename(actor.entryPath))).toEqual([
      "entry.ts",
      "entry.js",
    ]);
  });
});
