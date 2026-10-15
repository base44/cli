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

export const RequestBodySchema = z.looseObject({
  content: MediaTypesSchema.optional(),
});

export const ResponseObjectSchema = z.looseObject({
  description: z.string().optional(),
  content: MediaTypesSchema.optional(),
});

const SecurityRequirementSchema = z.record(z.string(), z.array(z.string()));

const OperationSchema = z.looseObject({
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().optional(),
  parameters: z.array(z.unknown()).optional(),
  requestBody: z.unknown().optional(),
  responses: z.record(z.string(), z.unknown()).optional(),
  security: z.array(SecurityRequirementSchema).optional(),
});

/** Path items also hold non-operation keys (`parameters`, `summary`, ...). */
const PathItemSchema = z.looseObject(
  Object.fromEntries(
    HTTP_METHODS.map((method) => [method, OperationSchema.optional()]),
  ) as Record<
    (typeof HTTP_METHODS)[number],
    z.ZodOptional<typeof OperationSchema>
  >,
);

export const OpenApiSpecSchema = z.looseObject({
  openapi: z.string(),
  paths: z.record(z.string(), PathItemSchema),
  components: z
    .looseObject({
      schemas: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  security: z.array(SecurityRequirementSchema).optional(),
});

export type OpenApiSpec = z.infer<typeof OpenApiSpecSchema>;
export type OpenApiOperation = z.infer<typeof OperationSchema>;
export { ParameterSchema };
