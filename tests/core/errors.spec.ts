import { describe, expect, it } from "vitest";
import {
  ApiError,
  AuthExpiredError,
  AuthRequiredError,
  ConfigExistsError,
  ConfigInvalidError,
  ConfigNotFoundError,
  FileNotFoundError,
  FileReadError,
  formatApiError,
  InternalError,
  InvalidInputError,
  isCLIError,
  isSystemError,
  isUserError,
  SchemaValidationError,
} from "../../src/core/errors.js";

describe("CLIError base class", () => {
  it("has correct properties on UserError subclass", () => {
    const error = new AuthRequiredError();
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(isUserError(error)).toBe(true);
    expect(error.hints.length).toBeGreaterThan(0);
    expect(error.message).toContain("Authentication required");
  });

  it("has correct properties on SystemError subclass", () => {
    const error = new ApiError("Test API error", { statusCode: 500 });
    expect(error.code).toBe("API_ERROR");
    expect(isUserError(error)).toBe(false);
    expect(error.statusCode).toBe(500);
    expect(error.hints.length).toBeGreaterThan(0);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("Original error");
    const error = new ApiError("Wrapped error", { cause });
    expect(error.cause).toBe(cause);
  });

  it("allows custom hints", () => {
    const customHints = [{ message: "Custom hint", command: "base44 help" }];
    const error = new InvalidInputError("Invalid input", {
      hints: customHints,
    });
    expect(error.hints).toEqual(customHints);
  });
});

describe("UserError subclasses", () => {
  it("AuthRequiredError has correct defaults", () => {
    const error = new AuthRequiredError();
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(isUserError(error)).toBe(true);
    expect(error.hints.some((h) => h.command === "base44 login")).toBe(true);
  });

  it("AuthExpiredError has correct defaults", () => {
    const error = new AuthExpiredError();
    expect(error.code).toBe("AUTH_EXPIRED");
    expect(isUserError(error)).toBe(true);
  });

  it("ConfigNotFoundError has correct defaults", () => {
    const error = new ConfigNotFoundError();
    expect(error.code).toBe("CONFIG_NOT_FOUND");
    expect(isUserError(error)).toBe(true);
    expect(error.hints.some((h) => h.command === "base44 create")).toBe(true);
    expect(error.hints.some((h) => h.command === "base44 link")).toBe(true);
  });

  it("ConfigInvalidError accepts custom message", () => {
    const error = new ConfigInvalidError("Custom invalid config message");
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toBe("Custom invalid config message");
  });

  it("ConfigExistsError accepts custom message", () => {
    const error = new ConfigExistsError("Project already exists");
    expect(error.code).toBe("CONFIG_EXISTS");
    expect(error.message).toBe("Project already exists");
  });

  it("SchemaValidationError formats ZodError without filePath", async () => {
    const { z } = await import("zod");
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 123 });

    if (!result.success) {
      const error = new SchemaValidationError("Invalid config", result.error);
      expect(error.code).toBe("SCHEMA_INVALID");
      expect(error.message).toContain("Invalid config");
      // Zod prettifyError uses lowercase
      expect(error.message).toContain("expected string");
      expect(error.message).toContain("name");
      expect(error.filePath).toBeUndefined();
    } else {
      throw new Error("Expected parse to fail");
    }
  });

  it("SchemaValidationError includes filePath in message and hints when provided", async () => {
    const { z } = await import("zod");
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 123 });

    if (!result.success) {
      const error = new SchemaValidationError(
        "Invalid entity file",
        result.error,
        "/path/to/entity.jsonc",
      );
      expect(error.code).toBe("SCHEMA_INVALID");
      expect(error.message).toContain(
        "Invalid entity file in /path/to/entity.jsonc",
      );
      expect(error.message).toContain("expected string");
      expect(error.filePath).toBe("/path/to/entity.jsonc");
      expect(error.hints[0].message).toContain("/path/to/entity.jsonc");
    } else {
      throw new Error("Expected parse to fail");
    }
  });

  it("InvalidInputError has no default hints", () => {
    const error = new InvalidInputError("Bad input");
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.hints).toEqual([]);
  });
});

describe("SystemError subclasses", () => {
  it("ApiError provides default hints based on status code", () => {
    const error401 = new ApiError("Unauthorized", { statusCode: 401 });
    expect(error401.hints.some((h) => h.command === "base44 login")).toBe(true);

    const error403 = new ApiError("Forbidden", { statusCode: 403 });
    expect(error403.hints.some((h) => h.message.includes("permission"))).toBe(
      true,
    );

    const error404 = new ApiError("Not found", { statusCode: 404 });
    expect(error404.hints.some((h) => h.message.includes("not found"))).toBe(
      true,
    );

    const error500 = new ApiError("Server error", { statusCode: 500 });
    expect(error500.hints.some((h) => h.message.includes("network"))).toBe(
      true,
    );
  });

  it("ApiError stores request and response data", () => {
    const responseBody = { error: "Bad Request", detail: "Invalid field" };
    const requestBody = '{"name":"test"}';
    const error = new ApiError("API failed", {
      statusCode: 400,
      requestUrl: "https://api.base44.com/v1/entities",
      requestMethod: "POST",
      requestBody,
      responseBody,
    });

    expect(error.statusCode).toBe(400);
    expect(error.requestUrl).toBe("https://api.base44.com/v1/entities");
    expect(error.requestMethod).toBe("POST");
    expect(error.requestBody).toBe(requestBody);
    expect(error.responseBody).toEqual(responseBody);
  });

  it("ApiError has undefined request/response fields when not provided", () => {
    const error = new ApiError("API failed", { statusCode: 500 });

    expect(error.statusCode).toBe(500);
    expect(error.requestUrl).toBeUndefined();
    expect(error.requestMethod).toBeUndefined();
    expect(error.requestBody).toBeUndefined();
    expect(error.responseBody).toBeUndefined();
  });

  it("ApiError.fromHttpError extracts request and response data from HTTPError", async () => {
    const { HTTPError } = await import("ky");
    const responseBody = { message: "Not Found" };
    const response = new Response(JSON.stringify(responseBody), {
      status: 404,
      statusText: "Not Found",
    });
    const request = new Request("https://api.base44.com/v1/apps/123", {
      method: "GET",
    });

    const httpError = new HTTPError(response, request, {} as never);
    const apiError = await ApiError.fromHttpError(httpError, "fetching app");

    expect(apiError.statusCode).toBe(404);
    expect(apiError.requestUrl).toBe("https://api.base44.com/v1/apps/123");
    expect(apiError.requestMethod).toBe("GET");
    expect(apiError.requestBody).toBeUndefined();
    expect(apiError.responseBody).toEqual(responseBody);
    expect(apiError.message).toContain("fetching app");
    expect(apiError.message).toContain("Not Found");
  });

  it("ApiError.fromHttpError includes request body from options.context.__requestBody when present", async () => {
    const { HTTPError } = await import("ky");
    const responseBody = { message: "Bad Request" };
    const response = new Response(JSON.stringify(responseBody), {
      status: 400,
      statusText: "Bad Request",
    });
    const request = new Request("https://api.base44.com/v1/entities", {
      method: "POST",
    });
    const options = {
      context: { __requestBody: '{"entities":[]}' },
    } as never;

    const httpError = new HTTPError(response, request, options);
    const apiError = await ApiError.fromHttpError(
      httpError,
      "pushing entities",
    );

    expect(apiError.requestBody).toBe('{"entities":[]}');
  });

  it("ApiError.fromHttpError handles non-JSON response body", async () => {
    const { HTTPError } = await import("ky");
    const response = new Response("Internal Server Error", {
      status: 500,
      statusText: "Internal Server Error",
    });
    const request = new Request("https://api.base44.com/v1/deploy", {
      method: "POST",
    });

    const httpError = new HTTPError(response, request, {} as never);
    const apiError = await ApiError.fromHttpError(httpError, "deploying");

    expect(apiError.statusCode).toBe(500);
    expect(apiError.requestUrl).toBe("https://api.base44.com/v1/deploy");
    expect(apiError.requestMethod).toBe("POST");
    expect(apiError.responseBody).toBeUndefined();
  });

  it("ApiError.fromHttpError handles plain Error", async () => {
    const error = new Error("Network timeout");
    const apiError = await ApiError.fromHttpError(error, "connecting");

    expect(apiError.statusCode).toBeUndefined();
    expect(apiError.requestUrl).toBeUndefined();
    expect(apiError.requestMethod).toBeUndefined();
    expect(apiError.requestBody).toBeUndefined();
    expect(apiError.responseBody).toBeUndefined();
    expect(apiError.message).toContain("connecting");
    expect(apiError.message).toContain("Network timeout");
  });

  it("FileNotFoundError has correct defaults", () => {
    const error = new FileNotFoundError("File not found: /path/to/file");
    expect(error.code).toBe("FILE_NOT_FOUND");
    expect(isSystemError(error)).toBe(true);
  });

  it("FileReadError has correct defaults", () => {
    const error = new FileReadError("Cannot read file");
    expect(error.code).toBe("FILE_READ_ERROR");
    expect(isSystemError(error)).toBe(true);
  });

  it("InternalError has correct defaults", () => {
    const error = new InternalError("Unexpected error");
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(isSystemError(error)).toBe(true);
  });
});

describe("Type guards", () => {
  it("isCLIError identifies CLIError instances", () => {
    expect(isCLIError(new AuthRequiredError())).toBe(true);
    expect(isCLIError(new ApiError("test"))).toBe(true);
    expect(isCLIError(new Error("regular error"))).toBe(false);
    expect(isCLIError("not an error")).toBe(false);
  });

  it("isUserError identifies UserError instances", () => {
    expect(isUserError(new AuthRequiredError())).toBe(true);
    expect(isUserError(new ConfigNotFoundError())).toBe(true);
    expect(isUserError(new ApiError("test"))).toBe(false);
    expect(isUserError(new Error("regular error"))).toBe(false);
  });

  it("isSystemError identifies SystemError instances", () => {
    expect(isSystemError(new ApiError("test"))).toBe(true);
    expect(isSystemError(new FileNotFoundError("test"))).toBe(true);
    expect(isSystemError(new AuthRequiredError())).toBe(false);
    expect(isSystemError(new Error("regular error"))).toBe(false);
  });
});

describe("formatApiError", () => {
  it("returns message when present", () => {
    const error = {
      error_type: "HTTPException",
      message: "Unauthorized access",
      detail: "Token expired",
    };

    expect(formatApiError(error)).toBe("Unauthorized access");
  });

  it("falls back to detail when message is not present", () => {
    const error = { detail: "Some error detail" };

    expect(formatApiError(error)).toBe("Some error detail");
  });

  it("falls back to full object when neither message nor detail present", () => {
    const error = { error_type: "UnknownError" };

    expect(formatApiError(error)).toBe('{\n  "error_type": "UnknownError"\n}');
  });

  it("stringifies message when it is an object", () => {
    const error = {
      message: { field: "name", error: "required" },
      detail: "some detail",
    };

    expect(formatApiError(error)).toBe(
      '{\n  "field": "name",\n  "error": "required"\n}',
    );
  });

  it("stringifies detail when it is an array", () => {
    const error = {
      detail: [{ loc: ["name"], msg: "field required" }],
    };

    expect(formatApiError(error)).toBe(
      '[\n  {\n    "loc": [\n      "name"\n    ],\n    "msg": "field required"\n  }\n]',
    );
  });

  it("handles null input", () => {
    expect(formatApiError(null)).toBe("null");
  });

  it("handles undefined input", () => {
    // JSON.stringify(undefined) returns undefined (not a string)
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(formatApiError(undefined)).toBeUndefined();
  });

  it("returns string as-is when input is a plain string", () => {
    expect(formatApiError("plain error string")).toBe("plain error string");
  });
});
