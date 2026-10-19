import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATIC_EGRESS_ARTIFACT_MARKER } from "@base44/functions-compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidInputError } from "@/core/errors.js";
import { compileActors } from "@/core/version/actors.js";

const ROOM = `import { Actor } from "base44:runtime/actors";
export default class Room extends Actor {
  handleMessage(conn, message) { this.broadcast(message); }
}
`;

describe("compileActors", () => {
  let root: string;
  const actorsDir = () => join(root, "base44", "actors");

  async function givenFile(path: string, content: string): Promise<void> {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "b44-actors-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is an empty set for an app with no actors, without loading the compiler", async () => {
    // The standalone binary cannot load the compiler, and an app with no
    // actors must still publish from it.
    expect(await compileActors(actorsDir())).toEqual([]);
  });

  it("compiles each actor into a module of its own, keyed at its folder", async () => {
    await givenFile("base44/actors/Room/entry.ts", ROOM);
    await givenFile("base44/actors/Lobby/entry.ts", ROOM);

    const actors = await compileActors(actorsDir());

    expect(actors.map(({ name, entry }) => ({ name, entry }))).toEqual([
      { name: "Lobby", entry: "base44/actors/Lobby/entry.ts" },
      { name: "Room", entry: "base44/actors/Room/entry.ts" },
    ]);
    const [lobby, room] = actors;
    expect(room).toMatchObject({
      source: ROOM,
      size: room.module.byteLength,
      digest: `sha256:${createHash("sha256").update(room.module).digest("hex")}`,
      staticEgress: STATIC_EGRESS_ARTIFACT_MARKER,
    });
    // Each its own Worker, exporting the class its folder names.
    expect(lobby.digest).not.toBe(room.digest);
    expect(new TextDecoder().decode(room.module)).toContain(
      STATIC_EGRESS_ARTIFACT_MARKER,
    );
  });

  it("keys an entry.js actor as entry.ts, and declares its source as written", async () => {
    const counter = ROOM.replace("Room", "Counter");
    await givenFile("base44/actors/Counter/entry.js", counter);

    const [actor] = await compileActors(actorsDir());

    expect(actor).toMatchObject({
      name: "Counter",
      entry: "base44/actors/Counter/entry.ts",
      source: counter,
    });
  });

  it("compiles the helpers and shared modules the entry reaches", async () => {
    await givenFile(
      "base44/actors/Room/entry.ts",
      `import { Actor } from "base44:runtime/actors";
import { limit } from "../../shared/limits.ts";
import { greet } from "./lib/greet.ts";
export default class Room extends Actor {
  handleConnect(conn) { conn.send(greet(limit)); }
}
`,
    );
    await givenFile(
      "base44/actors/Room/lib/greet.ts",
      "export const greet = (s: string) => 'room-helper-' + s;\n",
    );
    await givenFile(
      "base44/shared/limits.ts",
      `import { base } from "./base.ts";\nexport const limit = base + "-limit";\n`,
    );
    await givenFile(
      "base44/shared/base.ts",
      'export const base = "shared-base-module";\n',
    );

    const [actor] = await compileActors(actorsDir());

    const module = new TextDecoder().decode(actor.module);
    expect(module).toContain("room-helper-");
    expect(module).toContain("shared-base-module");
  });

  it("does not reach outside the actor's folder and the shared modules", async () => {
    // As apper scopes an actor: another actor's or a function's files are not
    // its to bundle, so the import has no target and the compile fails.
    await givenFile(
      "base44/actors/Room/entry.ts",
      `import { Actor } from "base44:runtime/actors";
import { helper } from "../../functions/tool/helper.ts";
export default class Room extends Actor {
  handleConnect(conn) { conn.send(helper); }
}
`,
    );
    await givenFile(
      "base44/functions/tool/helper.ts",
      "export const helper = 1;\n",
    );

    const error = await compileActors(actorsDir()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).details.join("\n")).toContain("Room");
  });

  it("compiles the same actors to the same bytes", async () => {
    // A version is named by the digest, so a rebuild of unchanged code must
    // not mint a new one.
    await givenFile("base44/actors/Room/entry.ts", ROOM);

    const first = await compileActors(actorsDir());
    const second = await compileActors(actorsDir());

    expect(second.map((a) => a.digest)).toEqual(first.map((a) => a.digest));
  });

  it("fails the whole set when one actor does not compile", async () => {
    await givenFile("base44/actors/Room/entry.ts", ROOM);
    await givenFile(
      "base44/actors/Broken/entry.ts",
      "export default class Broken {\n",
    );

    const error = await compileActors(actorsDir()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).details.join("\n")).toContain("Broken");
  });

  it("refuses more actors than a version may declare, before compiling any", async () => {
    for (let i = 0; i < 51; i++) {
      await givenFile(`base44/actors/Room${i}/entry.ts`, "not compiled\n");
    }

    await expect(compileActors(actorsDir())).rejects.toThrow(
      "Too many actors: found 51, the limit is 50.",
    );
  });
});
