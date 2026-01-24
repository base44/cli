import { z } from "zod";

/**
 * Entity field type definition (used for type generation, not strict validation)
 */
export interface EntityField {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: EntityField;
  properties?: Record<string, EntityField>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Entity definition type
 */
export interface EntityDefinition {
  name: string;
  type?: "object";
  properties?: Record<string, EntityField>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Schema for a full entity definition
 * Uses loose validation to allow JSON Schema flexibility
 */
export const EntityDefinitionSchema = z.object({
  name: z.string().min(1, "Entity name cannot be empty"),
  type: z.literal("object").optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
}).passthrough();
