import { spinner } from "@clack/prompts";

/**
 * Wraps an async operation with automatic spinner management.
 * The spinner is automatically started, and stopped on both success and error.
 *
 * @param startMessage - Message to show when spinner starts
 * @param operation - The async operation to execute. Receives an updateMessage function
 *                    to update the spinner text during long-running operations.
 * @param options - Optional configuration for success/error messages
 * @returns The result of the operation
 *
 * @example
 * // Simple usage
 * const data = await runTask(
 *   "Fetching data...",
 *   async () => {
 *     const response = await fetch(url);
 *     return response.json();
 *   },
 *   {
 *     successMessage: "Data fetched successfully",
 *     errorMessage: "Failed to fetch data",
 *   }
 * );
 *
 * @example
 * // With progress updates
 * const result = await runTask(
 *   "Processing files...",
 *   async (updateMessage) => {
 *     for (const file of files) {
 *       updateMessage(`Processing ${file.name}...`);
 *       await process(file);
 *     }
 *     return files.length;
 *   },
 *   { successMessage: "All files processed" }
 * );
 */
export async function runTask<T>(
  startMessage: string,
  operation: (updateMessage: (message: string) => void) => Promise<T>,
  options?: {
    successMessage?: string;
    errorMessage?: string;
  }
): Promise<T> {
  const s = spinner();
  s.start(startMessage);

  const updateMessage = (message: string) => s.message(message);

  try {
    const result = await operation(updateMessage);
    s.stop(options?.successMessage || startMessage);
    return result;
  } catch (error) {
    s.stop(options?.errorMessage || "Failed");
    throw error;
  }
}
