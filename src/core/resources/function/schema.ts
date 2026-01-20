import { z } from "zod";

export const FunctionConfigSchema = z.object({
  name: z
    .string()
    .min(1, "Function name cannot be empty")
    .refine((name) => !name.includes("."), "Function name cannot contain dots"),
  entry: z.string().min(1, "Entry point cannot be empty"),
  triggers: z.tuple([]).optional(),
});

export const FunctionSchema = FunctionConfigSchema.extend({
  codePath: z.string().min(1, "Code path cannot be empty"),
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
export type FunctionWithCode = Function & { code: string };
export type DeployFunctionsResponse = z.infer<
  typeof DeployFunctionsResponseSchema
>;

