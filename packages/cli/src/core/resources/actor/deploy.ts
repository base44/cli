import { dirname, relative } from "node:path";
import { ApiError } from "@/core/errors.js";
import { deploySingleActor } from "@/core/resources/actor/api.js";
import type {
  ActorDefinition,
  ActorOperationError,
  SingleActorDeleteResult,
  SingleActorDeployResult,
} from "@/core/resources/actor/schema.js";
import { readTextFile } from "@/core/utils/fs.js";

export function actorOperationError(
  name: string,
  error: unknown,
): ActorOperationError {
  return {
    name,
    status: "error",
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof ApiError
      ? { statusCode: error.statusCode, requestId: error.requestId }
      : {}),
  };
}

export function describeActorResult(
  result: SingleActorDeployResult | SingleActorDeleteResult,
): string {
  if (result.status !== "error") return `${result.name}: ${result.status}`;
  const context = [
    result.statusCode === undefined ? undefined : `HTTP ${result.statusCode}`,
    result.requestId ? `request ${result.requestId}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return `${result.name}: error — ${result.error}${context ? ` (${context})` : ""}`;
}

async function deployOne(
  actor: ActorDefinition,
): Promise<SingleActorDeployResult> {
  const start = Date.now();
  try {
    const actorDir = dirname(actor.entryPath);
    const files = await Promise.all(
      actor.filePaths.map(async (filePath) => ({
        path: relative(actorDir, filePath).split(/[/\\]/).join("/"),
        content: await readTextFile(filePath),
      })),
    );
    const response = await deploySingleActor(actor.name, {
      entry: actor.entry,
      files,
    });
    return { name: actor.name, ...response, durationMs: Date.now() - start };
  } catch (error) {
    return actorOperationError(actor.name, error);
  }
}

export async function deployActorsSequentially(
  actors: ActorDefinition[],
  options?: {
    onStart?: (name: string) => void;
    onResult?: (result: SingleActorDeployResult) => void;
  },
): Promise<SingleActorDeployResult[]> {
  const results: SingleActorDeployResult[] = [];
  for (const actor of actors) {
    options?.onStart?.(actor.name);
    const result = await deployOne(actor);
    results.push(result);
    options?.onResult?.(result);
  }
  return results;
}
