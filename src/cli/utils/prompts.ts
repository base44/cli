import { cancel } from "@clack/prompts";
import { CLIExitError } from "@/cli/errors.js";

/**
 * Standard onCancel handler for prompt groups.
g * Throws CLIExitError(0) for graceful exit when the user cancels.
 */
export const onPromptCancel = () => {
  cancel("Operation cancelled.");
  throw new CLIExitError(0);
};
