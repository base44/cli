import { randomUUID } from "node:crypto";
import { platform } from "node:os";

// Session ID is generated once per CLI invocation
let sessionId: string | null = null;

/**
 * Get or create a session ID for this CLI invocation.
 * The session ID persists for the lifetime of the CLI process.
 */
export function getSessionId(): string {
  if (!sessionId) {
    sessionId = randomUUID();
  }
  return sessionId;
}

/**
 * Reset the session ID. Useful for testing.
 */
export function resetSessionId(): void {
  sessionId = null;
}

/**
 * Get the current operating system name.
 */
export function getOS(): string {
  return platform();
}

/**
 * Get the Node.js version.
 */
export function getNodeVersion(): string {
  return process.version;
}
