import { text, isCancel, cancel } from "@clack/prompts";
import type { TextOptions } from "@clack/prompts";

/**
 * Handles prompt cancellation by exiting gracefully.
 */
function handleCancel<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
}

/**
 * Wrapper around @clack/prompts text() that handles cancellation automatically.
 * Returns the string value directly, exits process if cancelled.
 */
export async function textPrompt(options: TextOptions): Promise<string> {
  const value = await text(options);
  handleCancel(value);
  return value;
}
