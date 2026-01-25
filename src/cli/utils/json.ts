/**
 * JSON output utilities for CLI commands.
 *
 * These utilities support the `--json` flag which outputs machine-readable JSON
 * instead of human-friendly formatted output.
 */

let jsonModeEnabled = false;

/**
 * Enable JSON output mode. Called by runCommand when --json flag is detected.
 */
export function setJsonMode(enabled: boolean): void {
  jsonModeEnabled = enabled;
}

/**
 * Check if JSON output mode is currently active.
 */
export function isJsonMode(): boolean {
  return jsonModeEnabled;
}

/**
 * JSON success response structure.
 */
export interface JsonSuccessResponse {
  success: true;
  data: Record<string, unknown>;
}

/**
 * JSON error response structure.
 */
export interface JsonErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
  };
}

/**
 * Output a success JSON response to stdout.
 * Only outputs if JSON mode is enabled.
 */
export function outputJson(data: Record<string, unknown>): void {
  if (!jsonModeEnabled) {
    return;
  }

  const response: JsonSuccessResponse = {
    success: true,
    data,
  };
  console.log(JSON.stringify(response, null, 2));
}

/**
 * Output an error JSON response to stderr.
 * Only outputs if JSON mode is enabled.
 *
 * @param error - The error to output
 * @param code - Optional error code
 */
export function outputJsonError(error: Error | string, code?: string): void {
  if (!jsonModeEnabled) {
    return;
  }

  const message = error instanceof Error ? error.message : error;
  const response: JsonErrorResponse = {
    success: false,
    error: {
      message,
      ...(code && { code }),
    },
  };
  console.error(JSON.stringify(response, null, 2));
}
