/**
 * CLI Error System
 *
 * Error hierarchy:
 * - CLIError (base class)
 *   - UserError (user did something wrong - fixable by user)
 *   - SystemError (something broke - needs investigation)
 *
 * All errors support hints for actionable next steps.
 */

import { HTTPError } from "ky";
import { z } from "zod";
import {
  type ApiErrorResponse,
  ApiErrorResponseSchema,
} from "@/core/clients/schemas.js";

// ============================================================================
// API Error Response Parsing
// ============================================================================

/**
 * Extracts a human-readable error message from an API error response body.
 * Uses Zod schema to safely parse the response and extract message/detail.
 *
 * @param errorBody - The raw error response body (unknown type)
 * @returns A formatted error message string
 */
export function formatApiError(errorBody: unknown): string {
  const result = ApiErrorResponseSchema.safeParse(errorBody);

  if (result.success) {
    const { message, detail } = result.data;
    // Prefer message, fall back to detail
    const content = message ?? detail;
    if (typeof content === "string") {
      return content;
    }
    if (content !== undefined) {
      return JSON.stringify(content, null, 2);
    }
  }

  // Fallback for non-standard error responses
  if (typeof errorBody === "string") {
    return errorBody;
  }

  return JSON.stringify(errorBody, null, 2);
}

// ============================================================================
// Types
// ============================================================================

export interface ErrorHint {
  message: string;
  command?: string; // Optional command to run
}

interface CLIErrorOptions {
  hints?: ErrorHint[];
  cause?: Error;
}

// ============================================================================
// Base Classes
// ============================================================================

/**
 * Base class for all CLI errors.
 * Provides structured error data with code, hints, and cause tracking.
 */
abstract class CLIError extends Error {
  abstract readonly code: string;
  readonly hints: ErrorHint[];
  override readonly cause?: Error;

  constructor(message: string, options?: CLIErrorOptions) {
    super(message);
    this.name = this.constructor.name;
    this.hints = options?.hints ?? [];
    this.cause = options?.cause;

    // Maintain proper stack trace in V8 environments (Node.js)
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * User errors - the user did something wrong that they can fix.
 * Examples: not logged in, invalid config, missing project
 */
abstract class UserError extends CLIError {}

/**
 * System errors - something broke that needs investigation.
 * Examples: API failures, network issues, file system errors
 */
abstract class SystemError extends CLIError {}

// ============================================================================
// User Errors
// ============================================================================

/**
 * Thrown when the user is not authenticated.
 */
export class AuthRequiredError extends UserError {
  readonly code = "AUTH_REQUIRED";

  constructor(message = "Authentication required", options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        {
          message: "Run 'base44 login' to authenticate",
          command: "base44 login",
        },
      ],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when authentication has expired.
 */
export class AuthExpiredError extends UserError {
  readonly code = "AUTH_EXPIRED";

  constructor(
    message = "Authentication has expired",
    options?: CLIErrorOptions,
  ) {
    super(message, {
      hints: options?.hints ?? [
        {
          message: "Run 'base44 login' to re-authenticate",
          command: "base44 login",
        },
      ],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when a required config file is not found.
 */
export class ConfigNotFoundError extends UserError {
  readonly code = "CONFIG_NOT_FOUND";

  constructor(
    message = "No Base44 project found in this directory",
    options?: CLIErrorOptions,
  ) {
    super(message, {
      hints: options?.hints ?? [
        {
          message: "Run 'base44 create' to create a new project",
          command: "base44 create",
        },
        {
          message: "Or run 'base44 link' to link an existing project",
          command: "base44 link",
        },
      ],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when a config file has invalid syntax or structure.
 */
export class ConfigInvalidError extends UserError {
  readonly code = "CONFIG_INVALID";

  constructor(
    message: string,
    configFilePath?: string | null,
    options?: CLIErrorOptions,
  ) {
    const defaultHint = configFilePath
      ? `Check the file at ${configFilePath} for syntax errors`
      : "Check the file for syntax errors";
    super(message, {
      hints: options?.hints ?? [{ message: defaultHint }],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when trying to create a project that already exists.
 */
export class ConfigExistsError extends UserError {
  readonly code = "CONFIG_EXISTS";

  constructor(message: string, options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        {
          message: "Choose a different location or remove the existing project",
        },
      ],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when Zod/schema validation fails (data structure is wrong).
 *
 * @example
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   throw new SchemaValidationError("Invalid entity file", result.error, entityPath);
 * }
 */
export class SchemaValidationError extends UserError {
  readonly code = "SCHEMA_INVALID";
  readonly filePath?: string;

  constructor(context: string, zodError: z.ZodError, filePath?: string) {
    const message = filePath
      ? `${context} in ${filePath}:\n${z.prettifyError(zodError)}`
      : `${context}:\n${z.prettifyError(zodError)}`;

    const hints: ErrorHint[] = filePath
      ? [{ message: `Fix the schema/data structure errors in ${filePath}` }]
      : [{ message: "Fix the schema/data structure errors above" }];

    super(message, { hints });
    this.filePath = filePath;
  }
}

/**
 * Thrown when user input is invalid (e.g., template not found, project ID not found).
 */
export class InvalidInputError extends UserError {
  readonly code = "INVALID_INPUT";
}

// ============================================================================
// System Errors
// ============================================================================

interface ApiErrorOptions extends CLIErrorOptions {
  statusCode?: number;
  requestUrl?: string;
  requestMethod?: string;
  requestBody?: unknown;
  responseBody?: unknown;
}

/**
 * Thrown when an API request fails.
 */
export class ApiError extends SystemError {
  readonly code = "API_ERROR";
  readonly statusCode?: number;
  readonly requestUrl?: string;
  readonly requestMethod?: string;
  readonly requestBody?: unknown;
  readonly responseBody?: unknown;

  constructor(
    message: string,
    options?: ApiErrorOptions,
    parsedResponse?: ApiErrorResponse,
  ) {
    const hints =
      options?.hints ??
      ApiError.getReasonHints(parsedResponse) ??
      ApiError.getDefaultHints(options?.statusCode);
    super(message, { hints, cause: options?.cause });
    this.statusCode = options?.statusCode;
    this.requestUrl = options?.requestUrl;
    this.requestMethod = options?.requestMethod;
    this.requestBody = options?.requestBody;
    this.responseBody = options?.responseBody;
  }

  /**
   * Creates an ApiError from a caught error (typically HTTPError from ky).
   * Extracts status code, request info, and response body for error reporting.
   *
   * @param error - The caught error (HTTPError, Error, or unknown)
   * @param context - Description of what operation failed (e.g., "syncing agents")
   * @returns ApiError with formatted message, status code, and request/response data
   *
   * @example
   * try {
   *   const response = await appClient.get("endpoint");
   * } catch (error) {
   *   throw await ApiError.fromHttpError(error, "fetching data");
   * }
   */
  static async fromHttpError(
    error: unknown,
    context: string,
  ): Promise<ApiError> {
    if (error instanceof HTTPError) {
      let message: string;
      let responseBody: unknown;
      let parsedErrorResponse: ApiErrorResponse | undefined;
      try {
        responseBody = await error.response.clone().json();
        message = formatApiError(responseBody);
        const parsed = ApiErrorResponseSchema.safeParse(responseBody);
        if (parsed.success) {
          parsedErrorResponse = parsed.data;
        }
      } catch {
        message = error.message;
      }

      const requestBody = error.options.context?.__requestBody;

      return new ApiError(
        `Error ${context}: ${message}`,
        {
          statusCode: error.response.status,
          requestUrl: error.request.url,
          requestMethod: error.request.method,
          requestBody,
          responseBody,
          cause: error,
        },
        parsedErrorResponse,
      );
    }

    if (error instanceof Error) {
      return new ApiError(`Error ${context}: ${error.message}`, {
        cause: error,
      });
    }

    return new ApiError(`Error ${context}: ${String(error)}`);
  }

  private static getDefaultHints(statusCode?: number): ErrorHint[] {
    if (statusCode === 400) {
      return [
        {
          message:
            "The server rejected the request. Check the error message above for details.",
        },
      ];
    }
    if (statusCode === 401) {
      return [{ message: "Try logging in again", command: "base44 login" }];
    }
    if (statusCode === 403) {
      return [{ message: "You don't have permission to perform this action" }];
    }
    if (statusCode === 404) {
      return [{ message: "The requested resource was not found" }];
    }
    if (statusCode === 428) {
      return [
        {
          message:
            "The server rejected the request due to a precondition failure. Check the error message above for details",
        },
      ];
    }
    return [{ message: "Check your network connection and try again" }];
  }

  /**
   * Returns targeted hints for known `extra_data.reason` values
   * from a parsed API error response.
   * Add new entries to the map when the backend introduces new reason codes.
   */
  private static getReasonHints(
    parsedResponse?: ApiErrorResponse,
  ): ErrorHint[] | undefined {
    const REASON_HINTS: Record<string, ErrorHint[]> = {
      requires_backend_platform_app: [
        {
          message:
            "This feature requires an app created with the Base44 CLI. Remove `base44/.app.jsonc` and run 'base44 link' to connect your project to a CLI-created app.",
        },
        {
          message:
            "Read more at https://docs.base44.com/developers/backend/overview/introduction",
        },
      ],
    };

    const reason = parsedResponse?.extra_data?.reason;
    if (typeof reason !== "string") return undefined;

    return REASON_HINTS[reason];
  }
}

/**
 * Thrown when a file is not found.
 */
export class FileNotFoundError extends SystemError {
  readonly code = "FILE_NOT_FOUND";

  constructor(message: string, options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        { message: "Check the file path and try again" },
      ],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when a file cannot be read.
 */
export class FileReadError extends SystemError {
  readonly code = "FILE_READ_ERROR";

  constructor(message: string, options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        { message: "Check file permissions and try again" },
      ],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown for unexpected internal errors.
 */
export class InternalError extends SystemError {
  readonly code = "INTERNAL_ERROR";

  constructor(message: string, options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        {
          message:
            "This is an unexpected error. Please report it if it persists.",
        },
      ],
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when type generation fails for an entity.
 */
export class TypeGenerationError extends SystemError {
  readonly code = "TYPE_GENERATION_ERROR";
  readonly entityName?: string;

  constructor(message: string, entityName?: string, cause?: unknown) {
    super(message, {
      hints: [
        {
          message: entityName
            ? `Check the schema for entity "${entityName}"`
            : "Check your entity schemas for errors",
        },
      ],
      cause: cause instanceof Error ? cause : undefined,
    });
    this.entityName = entityName;
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an error is a CLIError (has code and hints).
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof CLIError;
}

/**
 * Check if an error is a UserError.
 */
export function isUserError(error: unknown): error is UserError {
  return error instanceof UserError;
}

/**
 * Check if an error is a SystemError.
 */
export function isSystemError(error: unknown): error is SystemError {
  return error instanceof SystemError;
}
