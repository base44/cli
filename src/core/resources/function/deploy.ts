import { basename } from "node:path";
import {
  deleteSingleFunction,
  deploySingleFunction,
  listDeployedFunctions,
} from "@/core/resources/function/api.js";
import type {
  BackendFunction,
  FunctionFile,
  FunctionWithCode,
} from "@/core/resources/function/schema.js";
import { readTextFile } from "@/core/utils/fs.js";

export async function loadFunctionCode(
  fn: BackendFunction,
): Promise<FunctionWithCode> {
  const resolvedFiles: FunctionFile[] = await Promise.all(
    fn.filePaths.map(async (filePath) => {
      const content = await readTextFile(filePath);
      return { path: basename(filePath), content };
    }),
  );
  return { ...fn, files: resolvedFiles };
}

export interface SingleFunctionDeployResult {
  name: string;
  status: "deployed" | "unchanged" | "error";
  error?: string | null;
  durationMs?: number | null;
}

async function deployOne(
  fn: BackendFunction,
): Promise<SingleFunctionDeployResult> {
  try {
    const functionWithCode = await loadFunctionCode(fn);
    const response = await deploySingleFunction(functionWithCode.name, {
      entry: functionWithCode.entry,
      files: functionWithCode.files,
      automations: functionWithCode.automations,
    });
    return {
      name: functionWithCode.name,
      status: response.status,
      durationMs: response.duration_ms,
    };
  } catch (error) {
    return {
      name: fn.name,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deployFunctionsSequentially(
  functions: BackendFunction[],
  options?: {
    onStart?: (names: string[]) => void;
    onResult?: (result: SingleFunctionDeployResult) => void;
  },
): Promise<SingleFunctionDeployResult[]> {
  if (functions.length === 0) return [];

  const results: SingleFunctionDeployResult[] = [];
  for (const fn of functions) {
    options?.onStart?.([fn.name]);
    const result = await deployOne(fn);
    results.push(result);
    options?.onResult?.(result);
  }
  return results;
}

export interface PruneResult {
  name: string;
  deleted: boolean;
  error?: string;
}

export async function pruneRemovedFunctions(
  localFunctionNames: string[],
): Promise<PruneResult[]> {
  const remote = await listDeployedFunctions();
  const localSet = new Set(localFunctionNames);
  const toDelete = remote.functions.filter((f) => !localSet.has(f.name));

  const results: PruneResult[] = [];

  for (const fn of toDelete) {
    try {
      await deleteSingleFunction(fn.name);
      results.push({ name: fn.name, deleted: true });
    } catch (error) {
      results.push({
        name: fn.name,
        deleted: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
