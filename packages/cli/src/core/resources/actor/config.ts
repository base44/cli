import { basename, dirname, relative } from "node:path";
import { globby } from "globby";
import {
  BACKEND_FILE_GLOB,
  ENTRY_FILE_GLOB,
  ENTRY_IGNORE_DOT_PATHS,
} from "@/core/consts.js";
import { ConfigInvalidError, InvalidInputError } from "@/core/errors.js";
import type { Actor } from "@/core/resources/actor/schema.js";
import { pathExists } from "@/core/utils/fs.js";

/**
 * An actor's name becomes a Durable Object class and the WebSocket connect
 * handler on the server, so it has to be a plain ASCII JavaScript identifier.
 * Mirrors the server's own rule — `PUT /api/apps/{app_id}/actors/{name}` 422s
 * anything else — so a bad folder name fails locally instead of mid-deploy.
 */
const VALID_ACTOR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/**
 * ES reserved words + strict-mode reserved words + `eval`/`arguments`. The
 * server interpolates the name into `import <Name> from …; export { <Name> }`,
 * so a reserved word would compile to invalid JavaScript.
 */
const JS_RESERVED_ACTOR_NAMES = new Set(
  (
    "await break case catch class const continue debugger default delete do else " +
    "enum export extends false finally for function if import in instanceof let " +
    "new null return static super switch this throw true try typeof var void " +
    "while with yield implements interface package private protected public " +
    "eval arguments"
  ).split(" "),
);

function assertValidActorName(name: string): void {
  if (name.includes("/")) {
    throw new ConfigInvalidError(
      `Invalid actor name "${name}" — actors cannot be nested in subfolders`,
      null,
      {
        hints: [
          {
            message: `Use a single folder level (e.g. actors/${name.split("/").pop()}/entry.ts)`,
          },
          {
            message:
              "A nested name can also mean a helper file was named entry.ts — every entry file under the actors directory is treated as an actor, so rename the helper",
          },
        ],
      },
    );
  }

  if (!VALID_ACTOR_NAME.test(name)) {
    throw new ConfigInvalidError(
      `Invalid actor name "${name}" — actor names become a JavaScript class binding, so they must match [A-Za-z_][A-Za-z0-9_]* (max 128 characters, no "-", "." or ":")`,
      null,
      {
        hints: [
          { message: "Rename the folder in PascalCase (e.g. actors/ChatRoom)" },
        ],
      },
    );
  }

  if (JS_RESERVED_ACTOR_NAMES.has(name)) {
    throw new ConfigInvalidError(
      `Invalid actor name "${name}" — it is a reserved word in JavaScript, and actor names become a class binding`,
      null,
      {
        hints: [
          { message: "Rename the folder in PascalCase (e.g. actors/ChatRoom)" },
        ],
      },
    );
  }
}

async function readActor(entryFile: string, actorsDir: string): Promise<Actor> {
  const actorDir = dirname(entryFile);
  const name = relative(actorsDir, actorDir).split(/[/\\]/).join("/");
  if (!name) {
    const entryName = basename(entryFile);
    throw new InvalidInputError(
      `${entryName} found directly in the actors directory — it must be inside a named subfolder`,
      {
        hints: [
          {
            message: `Move ${entryFile} into a subfolder (e.g. actors/MyActor/entry.ts)`,
          },
        ],
      },
    );
  }
  assertValidActorName(name);

  const filePaths = await globby(BACKEND_FILE_GLOB, {
    cwd: actorDir,
    absolute: true,
  });

  return {
    name,
    entry: basename(entryFile),
    entryPath: entryFile,
    filePaths,
    source: { type: "project" },
  };
}

export async function readAllActors(actorsDir: string): Promise<Actor[]> {
  if (!(await pathExists(actorsDir))) {
    return [];
  }

  // Same dot-path exclusion as functions: a folder with a dot in its name can
  // never be a valid actor name, so treat it as scratch (`ChatRoom.bak/`)
  // rather than a deploy that would 422.
  const entryFiles = await globby(ENTRY_FILE_GLOB, {
    cwd: actorsDir,
    absolute: true,
    ignore: ENTRY_IGNORE_DOT_PATHS,
  });

  const actors = await Promise.all(
    entryFiles.map((entryFile) => readActor(entryFile, actorsDir)),
  );

  const names = new Set<string>();
  for (const actor of actors) {
    if (names.has(actor.name)) {
      throw new ConfigInvalidError(
        `Duplicate actor name "${actor.name}" in ${actorsDir}`,
      );
    }
    names.add(actor.name);
  }

  return actors;
}
