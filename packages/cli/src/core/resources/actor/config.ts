import { basename, dirname, join, relative } from "node:path";
import { globby } from "globby";
import { ENTRY_FILE_GLOB, ENTRY_IGNORE_DOT_PATHS } from "@/core/consts.js";
import { InvalidInputError } from "@/core/errors.js";
import type {
  Actor,
  ActorMessageSchema,
} from "@/core/resources/actor/schema.js";
import { ActorSchemaFileSchema } from "@/core/resources/actor/schema.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";

async function readActor(entryFile: string, actorsDir: string): Promise<Actor> {
  const actorDir = dirname(entryFile);
  const filePaths = await globby("**/*.ts", {
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

  const entry = basename(entryFile);

  const schemaPath = join(actorDir, "schema.jsonc");
  let messageSchema: ActorMessageSchema | undefined;
  if (await pathExists(schemaPath)) {
    const parsed = await readJsonFile(schemaPath);
    const result = ActorSchemaFileSchema.safeParse(parsed);
    if (result.success) {
      messageSchema = {
        types: result.data.types as Record<string, unknown> | undefined,
        toClient: result.data.toClient as Record<string, unknown> | undefined,
        toServer: result.data.toServer as Record<string, unknown> | undefined,
      };
    }
  }

  return {
    name,
    entry,
    entryPath: entryFile,
    filePaths,
    source: { type: "project" },
    messageSchema,
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
      throw new InvalidInputError(
        `Duplicate actor name "${actor.name}" in ${actorsDir}`,
      );
    }
    names.add(actor.name);
  }

  return actors;
}
