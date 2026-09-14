import { AsyncLocalStorage } from "node:async_hooks";

export interface WorkerRuntimeContext {
  env: "prod" | "preview";
  fn?: string;
  secrets: Record<string, unknown>;
  workerEnv: Record<string, unknown>;
  waitUntil(promise: Promise<unknown>): void;
  [key: string]: unknown;
}

const runtimeContext = new AsyncLocalStorage<WorkerRuntimeContext>();

export function currentWorkerRuntimeContext():
  | WorkerRuntimeContext
  | undefined {
  return runtimeContext.getStore();
}

export function workerEnvironment(): Record<string, unknown> {
  return currentWorkerRuntimeContext()?.workerEnv ?? {};
}

export function runWithWorkerEnvironment<T>(
  context: WorkerRuntimeContext,
  callback: () => T,
): T {
  return runtimeContext.run(context, callback);
}
