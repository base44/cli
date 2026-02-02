import { z } from "zod";

/**
 * Input for JSON Schema generation with resource names.
 */
export interface SchemaGeneratorInput {
  entityNames: string[];
  functionNames: string[];
}

/**
 * Creates a dynamic Zod schema for agent config with actual resource names.
 */
function createDynamicAgentSchema(input: SchemaGeneratorInput) {
  // Create enum schemas for entity and function names
  // Fall back to string if no resources exist
  const EntityNameSchema =
    input.entityNames.length > 0
      ? z.enum(input.entityNames as [string, ...string[]])
      : z.string();

  const FunctionNameSchema =
    input.functionNames.length > 0
      ? z.enum(input.functionNames as [string, ...string[]])
      : z.string();

  // Entity tool config
  const EntityToolConfigSchema = z.object({
    entity_name: EntityNameSchema,
    allowed_operations: z.array(z.enum(["create", "update", "delete", "read"])),
  });

  // Backend function tool config
  const BackendFunctionToolConfigSchema = z.object({
    function_name: FunctionNameSchema,
    description: z.string().optional(),
  });

  // Tool config union
  const ToolConfigSchema = z.union([EntityToolConfigSchema, BackendFunctionToolConfigSchema]);

  // Full agent config schema
  return z.object({
    name: z.string().regex(/^[a-z0-9_]+$/),
    description: z.string(),
    instructions: z.string(),
    tool_configs: z.array(ToolConfigSchema).optional(),
    whatsapp_greeting: z.string().nullable().optional(),
  });
}

/**
 * Creates the Zod schema for entity config files.
 */
function createEntitySchema() {
  const PropertyTypeSchema = z.enum([
    "string",
    "number",
    "integer",
    "boolean",
    "array",
    "object",
    "binary",
  ]);

  const StringFormatSchema = z.enum([
    "date",
    "date-time",
    "time",
    "email",
    "uri",
    "hostname",
    "ipv4",
    "ipv6",
    "uuid",
    "file",
    "regex",
  ]);

  // Simplified property definition (non-recursive for JSON Schema generation)
  const PropertyDefinitionSchema = z.object({
    type: PropertyTypeSchema,
    title: z.string().optional(),
    description: z.string().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    pattern: z.string().optional(),
    format: StringFormatSchema.optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    enum: z.array(z.string()).optional(),
    enumNames: z.array(z.string()).optional(),
    default: z.unknown().optional(),
  });

  return z.object({
    type: z.literal("object"),
    name: z.string().regex(/^[a-zA-Z0-9]+$/),
    title: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), PropertyDefinitionSchema),
    required: z.array(z.string()).optional(),
  });
}

/**
 * Creates the Zod schema for function config files.
 */
function createFunctionSchema() {
  return z.object({
    name: z.string().regex(/^[^.]+$/),
    entry: z.string(),
  });
}

/**
 * Convert a Zod schema to JSON Schema using Zod v4's native support.
 */
function zodToJson(schema: z.ZodType): object {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-07",
  });

  return jsonSchema;
}

/**
 * Generate JSON Schema for agent config files.
 */
export function generateAgentJsonSchema(input: SchemaGeneratorInput): object {
  const schema = createDynamicAgentSchema(input);
  return zodToJson(schema);
}

/**
 * Generate JSON Schema for entity config files.
 */
export function generateEntityJsonSchema(): object {
  const schema = createEntitySchema();
  return zodToJson(schema);
}

/**
 * Generate JSON Schema for function config files.
 */
export function generateFunctionJsonSchema(): object {
  const schema = createFunctionSchema();
  return zodToJson(schema);
}

/**
 * All generated JSON schemas.
 */
export interface GeneratedSchemas {
  "agent.schema.json": object;
  "entity.schema.json": object;
  "function.schema.json": object;
}

/**
 * Generate all JSON Schema files.
 */
export function generateAllJsonSchemas(input: SchemaGeneratorInput): GeneratedSchemas {
  return {
    "agent.schema.json": generateAgentJsonSchema(input),
    "entity.schema.json": generateEntityJsonSchema(),
    "function.schema.json": generateFunctionJsonSchema(),
  };
}
