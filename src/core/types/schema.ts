import { z } from "zod";

/** JSON Schema primitive types */
export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

/**
 * Entity field type definition (JSON Schema compatible)
 * Supports both single types and union types (e.g., ["string", "null"])
 */
export interface EntityField {
  type: JsonSchemaType | JsonSchemaType[];
  description?: string;
  default?: unknown;
  /** Enum values - can be strings, numbers, or mixed */
  enum?: (string | number | boolean | null)[];
  /** For array types - schema of array items */
  items?: EntityField;
  /** For object types - nested property schemas */
  properties?: Record<string, EntityField>;
  /** For object types - list of required property names */
  required?: string[];
  /** JSON Schema format hint (date, date-time, email, uri, etc.) */
  format?: string;
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
