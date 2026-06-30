import { basename, dirname, relative } from "node:path";
import { globby } from "globby";
import { ENTRY_FILE_GLOB, ENTRY_IGNORE_DOT_PATHS } from "@/core/consts.js";
import { InvalidInputError } from "@/core/errors.js";
import type { RealtimeHandler } from "@/core/resources/realtime-handler/schema.js";
import { pathExists } from "@/core/utils/fs.js";

async function readRealtimeHandler(
  entryFile: string,
  realtimeDir: string,
): Promise<RealtimeHandler> {
  const handlerDir = dirname(entryFile);
  const filePaths = await globby("**/*.ts", {
    cwd: handlerDir,
    absolute: true,
  });

  const name = relative(realtimeDir, handlerDir).split(/[/\\]/).join("/");
  if (!name) {
    throw new InvalidInputError(
      "entry.ts found directly in the realtime directory — it must be inside a named subfolder",
      {
        hints: [
          {
            message: `Move ${entryFile} into a subfolder (e.g. realtime/myHandler/entry.ts)`,
          },
        ],
      },
    );
  }

  const entry = basename(entryFile);

  return {
    name,
    entry,
    entryPath: entryFile,
    filePaths,
    source: { type: "project" },
  };
}

export async function readAllRealtimeHandlers(
  realtimeDir: string,
): Promise<RealtimeHandler[]> {
  if (!(await pathExists(realtimeDir))) {
    return [];
  }

  const entryFiles = await globby(ENTRY_FILE_GLOB, {
    cwd: realtimeDir,
    absolute: true,
    ignore: ENTRY_IGNORE_DOT_PATHS,
  });

  const handlers = await Promise.all(
    entryFiles.map((entryFile) => readRealtimeHandler(entryFile, realtimeDir)),
  );

  const names = new Set<string>();
  for (const handler of handlers) {
    if (names.has(handler.name)) {
      throw new InvalidInputError(
        `Duplicate realtime handler name "${handler.name}" in ${realtimeDir}`,
      );
    }
    names.add(handler.name);
  }

  return handlers;
}
