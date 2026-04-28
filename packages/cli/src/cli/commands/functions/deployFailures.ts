import { DeploymentFailedError } from "@/core/errors.js";
import type { SingleFunctionDeployResult } from "@/core/resources/function/deploy.js";

export function buildFunctionDeployFailureMessage(
  results: SingleFunctionDeployResult[],
): string | null {
  const failed = results.filter((result) => result.status === "error").length;
  if (failed === 0) return null;

  return `${failed} ${failed === 1 ? "function" : "functions"} failed to deploy`;
}

export function throwIfFunctionDeployFailed(
  results: SingleFunctionDeployResult[],
): void {
  const message = buildFunctionDeployFailureMessage(results);
  if (message) {
    throw new DeploymentFailedError(message);
  }
}
