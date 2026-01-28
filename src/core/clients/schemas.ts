import { z } from "zod";

export const ApiErrorSchema = z.object({
  error_type: z.string().optional(),
  message: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  detail: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  traceback: z.string().optional(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;
