export class AuthApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AuthApiError";
  }
}

export class AuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthValidationError";
  }
}

/**
 * Standard API error response format from the Base44 backend.
 * All HTTP errors from FastAPI are returned in this format.
 */
export interface ApiErrorResponse {
  error_type: string;
  message: string;
  detail: string | Record<string, unknown> | unknown[];
  traceback?: string;
}

/**
 * Formats an API error response into a human-readable string.
 * Prefers `message` (human-readable) over `detail`.
 */
export function formatApiError(errorJson: unknown): string {
  const error = errorJson as Partial<ApiErrorResponse> | null;
  const content = error?.message ?? error?.detail ?? errorJson;
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}
