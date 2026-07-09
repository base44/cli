import { dirname, relative } from "node:path";
import { deploySingleActor } from "@/core/resources/actor/api.js";
import type { Actor } from "@/core/resources/actor/schema.js";
import type { FunctionFile } from "@/core/resources/function/schema.js";
import { readTextFile } from "@/core/utils/fs.js";

async function loadActorCode(
  actor: Actor,
): Promise<{ name: string; entry: string; files: FunctionFile[] }> {
  const actorDir = dirname(actor.entryPath);
  const resolvedFiles: FunctionFile[] = await Promise.all(
    actor.filePaths.map(async (filePath) => {
      const content = await readTextFile(filePath);
      const path = relative(actorDir, filePath).split(/[/\\]/).join("/");
      return { path, content };
    }),
  );
  return { name: actor.name, entry: actor.entry, files: resolvedFiles };
}

export interface SingleActorDeployResult {
  name: string;
  status: "deployed" | "unchanged" | "error";
  error?: string | null;
  durationMs?: number;
}

async function deployOne(actor: Actor): Promise<SingleActorDeployResult> {
  const start = Date.now();
  try {
    const loaded = await loadActorCode(actor);
    const response = await deploySingleActor(loaded.name, {
      entry: loaded.entry,
      files: loaded.files,
    });
    return {
      name: loaded.name,
      status: response.status,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: actor.name,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deployActorsSequentially(
  actors: Actor[],
  options?: {
    onStart?: (names: string[]) => void;
    onResult?: (result: SingleActorDeployResult) => void;
  },
): Promise<SingleActorDeployResult[]> {
  if (actors.length === 0) return [];

  const results: SingleActorDeployResult[] = [];
  for (const actor of actors) {
    options?.onStart?.([actor.name]);
    const result = await deployOne(actor);
    results.push(result);
    options?.onResult?.(result);
  }
  return results;
}
