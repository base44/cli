import { z } from "zod";

const FunctionNameSchema = z
  .string()
  .trim()
  .min(1, "Function name cannot be empty")
  .regex(/^[^.]+$/, "Function name cannot contain dots");

const FunctionFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const FunctionConfigSchema = z.object({
  name: FunctionNameSchema,
  entry: z.string().min(1, "Entry point cannot be empty"),
});

export const BackendFunctionSchema = FunctionConfigSchema.extend({
  entryPath: z.string().min(1, "Entry path cannot be empty"),
  filePaths: z.array(z.string()).min(1, "Function must have at least one file"),
});

export const FunctionDeploySchema = z.object({
  name: FunctionNameSchema,
  entry: z.string().min(1),
  files: z
    .array(FunctionFileSchema)
    .min(1, "Function must have at least one file"),
});

export const DeployFunctionsResponseSchema = z.object({
  deployed: z.array(z.string()),
  deleted: z.array(z.string()),
  errors: z
    .array(z.object({ name: z.string(), message: z.string() }))
    .nullable(),
});

export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;
export type BackendFunction = z.infer<typeof BackendFunctionSchema>;
export type FunctionFile = z.infer<typeof FunctionFileSchema>;
export type FunctionDeploy = z.infer<typeof FunctionDeploySchema>;
export type DeployFunctionsResponse = z.infer<
  typeof DeployFunctionsResponseSchema
>;

export type FunctionWithCode = Omit<BackendFunction, "files"> & {
  files: FunctionFile[];
};

// ─── FUNCTION LOGS SCHEMAS ──────────────────────────────────

/**
 * Log level from Deno Deploy runtime.
 */
export const LogLevelSchema = z.enum(["log", "info", "warn", "error", "debug"]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Single log entry from the function runtime (Deno Deploy).
 */
export const FunctionLogEntrySchema = z.object({
  time: z.string(),
  level: LogLevelSchema,
  message: z.string(),
});

export type FunctionLogEntry = z.infer<typeof FunctionLogEntrySchema>;

/**
 * Response from the function logs API - array of log entries.
 */
export const FunctionLogsResponseSchema = z.array(FunctionLogEntrySchema);

export type FunctionLogsResponse = z.infer<typeof FunctionLogsResponseSchema>;

/**
 * CLI filter options for function logs.
 */
export interface FunctionLogFilters {
  since?: string;
  until?: string;
  level?: LogLevel;
  limit?: number;
}
