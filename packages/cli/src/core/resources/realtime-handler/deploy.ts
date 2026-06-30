import { dirname, relative } from "node:path";
import { deploySingleRealtimeHandler } from "@/core/resources/realtime-handler/api.js";
import type { RealtimeHandler } from "@/core/resources/realtime-handler/schema.js";
import type { FunctionFile } from "@/core/resources/function/schema.js";
import { readTextFile } from "@/core/utils/fs.js";

async function loadHandlerCode(
  handler: RealtimeHandler,
): Promise<{ name: string; entry: string; files: FunctionFile[] }> {
  const handlerDir = dirname(handler.entryPath);
  const resolvedFiles: FunctionFile[] = await Promise.all(
    handler.filePaths.map(async (filePath) => {
      const content = await readTextFile(filePath);
      const path = relative(handlerDir, filePath).split(/[/\\]/).join("/");
      return { path, content };
    }),
  );
  return { name: handler.name, entry: handler.entry, files: resolvedFiles };
}

export interface SingleRealtimeHandlerDeployResult {
  name: string;
  status: "deployed" | "unchanged" | "error";
  error?: string | null;
  durationMs?: number;
}

async function deployOne(
  handler: RealtimeHandler,
): Promise<SingleRealtimeHandlerDeployResult> {
  const start = Date.now();
  try {
    const loaded = await loadHandlerCode(handler);
    const response = await deploySingleRealtimeHandler(loaded.name, {
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
      name: handler.name,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deployRealtimeHandlersSequentially(
  handlers: RealtimeHandler[],
  options?: {
    onStart?: (names: string[]) => void;
    onResult?: (result: SingleRealtimeHandlerDeployResult) => void;
  },
): Promise<SingleRealtimeHandlerDeployResult[]> {
  if (handlers.length === 0) return [];

  const results: SingleRealtimeHandlerDeployResult[] = [];
  for (const handler of handlers) {
    options?.onStart?.([handler.name]);
    const result = await deployOne(handler);
    results.push(result);
    options?.onResult?.(result);
  }
  return results;
}
