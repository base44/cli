import { basename, dirname, join, relative } from "node:path";
import { globby } from "globby";
import {
  BACKEND_FILE_GLOB,
  ENTRY_FILE_GLOB,
  ENTRY_IGNORE_DOT_PATHS,
} from "@/core/consts.js";
import { ConfigInvalidError, InvalidInputError } from "@/core/errors.js";
import {
  type ActorDefinition,
  validateActorName,
} from "@/core/resources/actor/schema.js";
import { pathExists } from "@/core/utils/fs.js";

export async function readAllActors(
  actorsDir: string,
): Promise<ActorDefinition[]> {
  if (!(await pathExists(actorsDir))) return [];

  const entries = await globby(ENTRY_FILE_GLOB, {
    cwd: actorsDir,
    absolute: true,
    ignore: ENTRY_IGNORE_DOT_PATHS,
  });
  const actors: ActorDefinition[] = [];
  const names = new Set<string>();

  for (const entryPath of entries.sort()) {
    const actorDir = dirname(entryPath);
    const name = relative(actorsDir, actorDir).split(/[/\\]/).join("/");
    if (!name) {
      throw new InvalidInputError(
        "entry.ts or entry.js found directly in the actors directory — it must be inside a named subfolder",
      );
    }
    if (name.includes("/")) {
      throw new InvalidInputError(
        `Invalid actor name '${name}' — actors cannot be nested`,
      );
    }
    validateActorName(name);
    if (names.has(name)) {
      throw new ConfigInvalidError(
        `Duplicate actor name "${name}" in ${actorsDir}`,
        actorsDir,
      );
    }
    names.add(name);
    const filePaths = (
      await globby(BACKEND_FILE_GLOB, { cwd: actorDir, absolute: true })
    ).sort();
    const entry = basename(entryPath) === "entry.js" ? "entry.js" : "entry.ts";
    actors.push({
      name,
      entry,
      entryPath: join(actorDir, entry),
      filePaths,
      source: { type: "project" },
    });
  }
  return actors;
}
