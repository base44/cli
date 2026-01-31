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

import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export interface ErrorHint {
  message: string;
  command?: string; // Optional command to run
}

export interface CLIErrorOptions {
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
export abstract class CLIError extends Error {
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
export abstract class UserError extends CLIError {}

/**
 * System errors - something broke that needs investigation.
 * Examples: API failures, network issues, file system errors
 */
export abstract class SystemError extends CLIError {}

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
        { message: "Run 'base44 login' to authenticate", command: "base44 login" },
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

  constructor(message = "Authentication has expired", options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        { message: "Run 'base44 login' to re-authenticate", command: "base44 login" },
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

  constructor(message = "No Base44 project found in this directory", options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        { message: "Run 'base44 create' to create a new project", command: "base44 create" },
        { message: "Or run 'base44 link' to link an existing project", command: "base44 link" },
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

  constructor(message: string, options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [
        { message: "Check config.jsonc syntax and fix any errors" },
      ],
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
        { message: "Choose a different location or remove the existing project" },
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
 *   throw new SchemaValidationError("Invalid entity file", result.error);
 * }
 */
export class SchemaValidationError extends UserError {
  readonly code = "SCHEMA_INVALID";

  constructor(context: string, zodError: z.ZodError) {
    super(`${context}:\n${z.prettifyError(zodError)}`, {
      hints: [{ message: "Fix the schema/data structure errors above" }],
    });
  }
}

/**
 * Thrown when user input is invalid (e.g., template not found, project ID not found).
 */
export class InvalidInputError extends UserError {
  readonly code = "INVALID_INPUT";

  constructor(message: string, options?: CLIErrorOptions) {
    super(message, options);
  }
}

// ============================================================================
// System Errors
// ============================================================================

/**
 * Thrown when an API request fails.
 */
export class ApiError extends SystemError {
  readonly code = "API_ERROR";
  readonly statusCode?: number;

  constructor(message: string, options?: CLIErrorOptions & { statusCode?: number }) {
    const hints = options?.hints ?? ApiError.getDefaultHints(options?.statusCode);
    super(message, { hints, cause: options?.cause });
    this.statusCode = options?.statusCode;
  }

  private static getDefaultHints(statusCode?: number): ErrorHint[] {
    if (statusCode === 401) {
      return [{ message: "Try logging in again", command: "base44 login" }];
    }
    if (statusCode === 403) {
      return [{ message: "You don't have permission to perform this action" }];
    }
    if (statusCode === 404) {
      return [{ message: "The requested resource was not found" }];
    }
    return [{ message: "Check your network connection and try again" }];
  }
}

/**
 * Thrown when a file is not found.
 */
export class FileNotFoundError extends SystemError {
  readonly code = "FILE_NOT_FOUND";

  constructor(message: string, options?: CLIErrorOptions) {
    super(message, {
      hints: options?.hints ?? [{ message: "Check the file path and try again" }],
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
      hints: options?.hints ?? [{ message: "Check file permissions and try again" }],
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
        { message: "This is an unexpected error. Please report it if it persists." },
      ],
      cause: options?.cause,
    });
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
