import { z } from "zod";

export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;

const ParameterSchema = z.looseObject({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: z.unknown().optional(),
  example: z.unknown().optional(),
});

const MediaTypesSchema = z.record(
  z.string(),
  z.looseObject({ schema: z.unknown().optional() }),
);

/** A request body or a response: both carry `content` keyed by media type. */
export const MediaContentSchema = z.looseObject({
  content: MediaTypesSchema.optional(),
});

export const ResponseObjectSchema = z.looseObject({
  description: z.string().optional(),
  content: MediaTypesSchema.optional(),
});

const SecurityRequirementSchema = z.record(z.string(), z.array(z.string()));

export const OperationSchema = z.looseObject({
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().optional(),
  parameters: z.array(z.unknown()).optional(),
  requestBody: z.unknown().optional(),
  responses: z.record(z.string(), z.unknown()).optional(),
  security: z.array(SecurityRequirementSchema).optional(),
});

export const OpenApiSpecSchema = z.looseObject({
  openapi: z.string(),
  // Operations are validated one by one in listOperations, so one malformed
  // route is skipped instead of failing every command.
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
  components: z
    .looseObject({
      schemas: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  security: z.array(SecurityRequirementSchema).optional().catch(undefined),
});

export const ParameterListSchema = z.array(z.unknown());

export type OpenApiSpec = z.infer<typeof OpenApiSpecSchema>;
export type OpenApiOperation = z.infer<typeof OperationSchema>;
export { ParameterSchema };
