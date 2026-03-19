/**
 * Logger interface for CLI output.
 *
 * Maps 1:1 to `@clack/prompts` log methods. Commands use this interface
 * instead of importing clack directly, so the right output strategy
 * (interactive clack UI vs plain text for CI) is chosen automatically.
 */
export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  step(message: string): void;
  message(message: string): void;
}
