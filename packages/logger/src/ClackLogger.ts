import { log } from "@clack/prompts";
import type { Logger } from "./types.js";

/**
 * Interactive logger that delegates to `@clack/prompts` log methods.
 * Used when the CLI is running in a TTY (interactive terminal).
 */
export class ClackLogger implements Logger {
  info(message: string): void {
    log.info(message);
  }
  success(message: string): void {
    log.success(message);
  }
  warn(message: string): void {
    log.warn(message);
  }
  error(message: string): void {
    log.error(message);
  }
  step(message: string): void {
    log.step(message);
  }
  message(message: string): void {
    log.message(message);
  }
}
