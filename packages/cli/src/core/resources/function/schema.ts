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

// Base fields shared by all automation types
const AutomationBaseSchema = z.object({
  name: z.string().min(1, "Automation name cannot be empty"),
  description: z.string().nullable().optional(),
  function_args: z.record(z.string(), z.unknown()).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

// One-time scheduled automation
const ScheduledOneTimeSchema = AutomationBaseSchema.extend({
  type: z.literal("scheduled"),
  schedule_mode: z.literal("one-time"),
  one_time_date: z
    .string()
    .min(1, "One-time date is required for one-time schedules"),
});

// Recurring cron scheduled automation
const ScheduledCronSchema = AutomationBaseSchema.extend({
  type: z.literal("scheduled"),
  schedule_mode: z.literal("recurring"),
  schedule_type: z.literal("cron"),
  cron_expression: z
    .string()
    .min(1, "Cron expression is required for cron schedules"),
  ends_type: z.enum(["never", "on", "after"]).optional().default("never"),
  ends_on_date: z.string().nullable().optional(),
  ends_after_count: z.number().int().positive().nullable().optional(),
});

// Recurring simple scheduled automation
const ScheduledSimpleSchema = AutomationBaseSchema.extend({
  type: z.literal("scheduled"),
  schedule_mode: z.literal("recurring"),
  schedule_type: z.literal("simple"),
  repeat_unit: z.enum(["minutes", "hours", "days", "weeks", "months"]),
  repeat_interval: z.number().int().positive().optional(),
  start_time: z.string().nullable().optional(),
  repeat_on_days: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  repeat_on_day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  ends_type: z.enum(["never", "on", "after"]).optional().default("never"),
  ends_on_date: z.string().nullable().optional(),
  ends_after_count: z.number().int().positive().nullable().optional(),
});

// Entity event automation
const EntityAutomationSchema = AutomationBaseSchema.extend({
  type: z.literal("entity"),
  entity_name: z.string().min(1, "Entity name cannot be empty"),
  event_types: z
    .array(z.enum(["create", "update", "delete"]))
    .min(1, "At least one event type is required"),
});

// Union of all automation types
const AutomationSchema = z.union([
  ScheduledOneTimeSchema,
  ScheduledCronSchema,
  ScheduledSimpleSchema,
  EntityAutomationSchema,
]);

export const FunctionConfigSchema = z.object({
  name: FunctionNameSchema,
  entry: z.string().min(1, "Entry point cannot be empty"),
  automations: z.array(AutomationSchema).optional(),
});

const BackendFunctionSchema = FunctionConfigSchema.extend({
  entryPath: z.string().min(1, "Entry path cannot be empty"),
  filePaths: z.array(z.string()).min(1, "Function must have at least one file"),
});

export const DeploySingleFunctionResponseSchema = z.object({
  status: z.enum(["deployed", "unchanged"]),
});

const FunctionInfoSchema = z
  .object({
    name: z.string(),
    deployment_id: z.string(),
    entry: z.string(),
    files: z.array(FunctionFileSchema),
    automations: z.array(AutomationSchema),
  })
  .transform((data) => ({
    name: data.name,
    deploymentId: data.deployment_id,
    entry: data.entry,
    files: data.files,
    automations: data.automations,
  }));

export const ListFunctionsResponseSchema = z.object({
  functions: z.array(FunctionInfoSchema),
});

export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;
export type BackendFunction = z.infer<typeof BackendFunctionSchema>;
export type FunctionFile = z.infer<typeof FunctionFileSchema>;
export type DeploySingleFunctionResponse = z.infer<
  typeof DeploySingleFunctionResponseSchema
>;
export type FunctionInfo = z.infer<typeof FunctionInfoSchema>;
export type ListFunctionsResponse = z.infer<typeof ListFunctionsResponseSchema>;

export type FunctionWithCode = Omit<BackendFunction, "filePaths"> & {
  files: FunctionFile[];
};

/**
 * Log levels from Deno Deploy runtime.
 */
export const LogLevelSchema = z.enum(["info", "warning", "error", "debug"]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

const FunctionLogEntrySchema = z.object({
  time: z.string(),
  level: LogLevelSchema,
  message: z.string(),
});

export const FunctionLogsResponseSchema = z.array(FunctionLogEntrySchema);

export type FunctionLogsResponse = z.infer<typeof FunctionLogsResponseSchema>;

export interface FunctionLogFilters {
  since?: string;
  until?: string;
  level?: LogLevel;
  limit?: number;
  order?: "asc" | "desc";
}
