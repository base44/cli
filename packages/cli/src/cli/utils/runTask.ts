import type { Logger } from "@base44-cli/logger";
import { spinner } from "@clack/prompts";

export type RunTaskFn = <T>(
  startMessage: string,
  operation: (updateMessage: (message: string) => void) => Promise<T>,
  options?: {
    successMessage?: string;
    errorMessage?: string;
  },
) => Promise<T>;

/**
 * Creates a RunTaskFn that uses clack spinner for interactive terminals.
 */
export function createInteractiveRunTask(): RunTaskFn {
  return async (startMessage, operation, options) => {
    const s = spinner();
    s.start(startMessage);

    const updateMessage = (message: string) => s.message(message);

    try {
      const result = await operation(updateMessage);
      s.stop(options?.successMessage || startMessage);
      return result;
    } catch (error) {
      s.error(options?.errorMessage || "Failed");
      throw error;
    }
  };
}

export function createSimpleRunTask(log: Logger): RunTaskFn {
  return async (startMessage, operation, options) => {
    log.info(startMessage);

    const updateMessage = (message: string) => log.info(message);

    try {
      const result = await operation(updateMessage);
      log.success(options?.successMessage || startMessage);
      return result;
    } catch (error) {
      log.error(options?.errorMessage || "Failed");
      throw error;
    }
  };
}
