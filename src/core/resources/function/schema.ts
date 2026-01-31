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

export const FunctionSchema = FunctionConfigSchema.extend({
  entryPath: z.string().min(1, "Entry path cannot be empty"),
  files: z.array(z.string()).min(1, "Function must have at least one file"),
});

export const FunctionDeploySchema = z.object({
  name: FunctionNameSchema,
  entry: z.string().min(1),
  files: z.array(FunctionFileSchema).min(1, "Function must have at least one file"),
});

export const DeployFunctionsResponseSchema = z.object({
  deployed: z.array(z.string()),
  deleted: z.array(z.string()),
  errors: z
    .array(z.object({ name: z.string(), message: z.string() }))
    .nullable(),
});

export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;
export type Function = z.infer<typeof FunctionSchema>;
export type FunctionFile = z.infer<typeof FunctionFileSchema>;
export type FunctionDeploy = z.infer<typeof FunctionDeploySchema>;
export type DeployFunctionsResponse = z.infer<typeof DeployFunctionsResponseSchema>;

export type FunctionWithCode = Omit<Function, "files"> & {
  files: FunctionFile[];
};

