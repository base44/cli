import { cancel } from "@clack/prompts";

/**
 * Standard onCancel handler for prompt groups.
 * Exits the process gracefully when the user cancels.
 */
export const onPromptCancel = () => {
  cancel("Operation cancelled.");
  process.exit(0);
};
