import { z } from "zod";

/**
 * Schema for parsing API error responses from the Base44 backend.
 */
export const ApiErrorResponseSchema = z.looseObject({
  message: z.unknown().optional(),
  detail: z.unknown().optional(),
  extra_data: z
    .looseObject({
      reason: z.string().optional().catch(undefined),
      errors: z
        .array(z.looseObject({ name: z.string(), message: z.string() }))
        .optional()
        .catch(undefined),
    })
    .optional()
    .nullable()
    .catch(undefined),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
