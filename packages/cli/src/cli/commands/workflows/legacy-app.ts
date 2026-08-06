import { ApiError, InvalidInputError } from "@/core/errors.js";

const isWorkflowsNotEnabled = (error: unknown) =>
  error instanceof ApiError && error.statusCode === 403;

export function rethrowLegacyAppAsExplanation(error: unknown): never {
  if (isWorkflowsNotEnabled(error)) {
    throw new InvalidInputError(
      "Workflows are not enabled for this app — it predates the Workflows system, so its automation runs are not readable via this command.",
    );
  }
  throw error;
}
