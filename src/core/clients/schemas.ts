import { z } from "zod";

/**
 * Schema for parsing API error responses from the Base44 backend.
 */
export const ApiErrorResponseSchema = z.object({
  error_type: z.string().optional(),
  message: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .nullable()
    .optional(),
  detail: z
    .union([
      z.string(),
      z.record(z.string(), z.unknown()),
      z.array(z.unknown()),
    ])
    .nullable()
    .optional(),
  traceback: z.string().nullable().optional(),
  extra_data: z
    .looseObject({
      reason: z.string().optional(),
      errors: z
        .array(
          z.union([
            z.object({ name: z.string(), message: z.string() }),
            z.string(),
          ]),
        )
        .optional(),
    })
    .optional()
    .nullable(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
