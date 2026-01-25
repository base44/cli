/**
 * Error thrown to signal a controlled CLI exit with a specific exit code.
 * This allows proper error propagation without calling process.exit() directly,
 * making the code more testable and maintaining a single exit point.
 */
export class CLIExitError extends Error {
  constructor(public readonly code: number) {
    super(`CLI exited with code ${code}`);
    this.name = "CLIExitError";
  }
}
