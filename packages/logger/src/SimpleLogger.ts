import type { Logger } from "./types.js";

/**
 * Plain-text logger for non-interactive mode (CI, piped output).
 * Writes to stderr to keep stdout clean for machine-readable output.
 */
export class SimpleLogger implements Logger {
  info(message: string): void {
    process.stderr.write(`${message}\n`);
  }
  success(message: string): void {
    process.stderr.write(`${message}\n`);
  }
  warn(message: string): void {
    process.stderr.write(`Warning: ${message}\n`);
  }
  error(message: string): void {
    process.stderr.write(`Error: ${message}\n`);
  }
  step(message: string): void {
    process.stderr.write(`${message}\n`);
  }
  message(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
