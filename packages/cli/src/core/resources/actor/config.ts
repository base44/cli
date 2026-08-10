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

async function readActor(entryFile: string, actorsDir: string): Promise<Actor> {
  const actorDir = dirname(entryFile);
  const filePaths = await globby(BACKEND_FILE_GLOB, {
    cwd: actorDir,
    absolute: true,
  });

  const name = relative(actorsDir, actorDir).split(/[/\\]/).join("/");
  if (!name) {
    throw new InvalidInputError(
      "entry.ts found directly in the actors directory — it must be inside a named subfolder",
      {
        hints: [
          {
            message: `Move ${entryFile} into a subfolder (e.g. actors/MyActor/entry.ts)`,
          },
        ],
      },
    );
  }

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
