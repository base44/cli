import { spinner } from "@clack/prompts";

/**
 * Wraps an async operation with automatic spinner management.
 * The spinner is automatically started, and stopped on both success and error.
 *
 * @param startMessage - Message to show when spinner starts
 * @param operation - The async operation to execute
 * @param options - Optional configuration for success/error messages
 * @returns The result of the operation
 *
 * @example
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
 */
export async function runTask<T>(
  startMessage: string,
  operation: () => Promise<T>,
  options?: {
    successMessage?: string;
    errorMessage?: string;
  }
): Promise<T> {
  const s = spinner();
  s.start(startMessage);

  try {
    const result = await operation();
    s.stop(options?.successMessage || startMessage);
    return result;
  } catch (error) {
    s.stop(options?.errorMessage || "Failed");
    throw error;
  }
}

