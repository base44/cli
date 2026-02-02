import { compile } from "json-schema-to-typescript";
import type { Entity } from "@/core/resources/entity/index.js";
import type { Function } from "@/core/resources/function/index.js";
import type { AgentConfig } from "@/core/resources/agent/index.js";

/**
 * Input for type generation containing all project resources.
 */
export interface TypesInput {
  entities: Entity[];
  functions: Function[];
  agents: AgentConfig[];
}

/**
 * Options for type generation.
 */
export interface TypesOptions {
  outputDir: string;
}

/**
 * Result of type generation.
 */
export interface TypesResult {
  files: string[];
  entityCount: number;
  functionCount: number;
  agentCount: number;
}

/**
 * Convert a CLI entity schema to JSON Schema format for json-schema-to-typescript.
 */
function entityToJsonSchema(entity: Entity): object {
  const properties: Record<string, object> = {};

  for (const [propName, propDef] of Object.entries(entity.properties)) {
    properties[propName] = propertyToJsonSchema(propDef);
  }

  return {
    type: "object",
    title: entity.name,
    description: entity.description,
    properties,
    required: entity.required ?? [],
    additionalProperties: false,
  };
}

/**
 * Convert a property definition to JSON Schema format.
 */
function propertyToJsonSchema(prop: Record<string, unknown>): object {
  const result: Record<string, unknown> = {};

  // Handle type
  if (prop.type === "integer") {
    result.type = "number";
  } else if (prop.type === "binary") {
    result.type = "string";
    result.format = "binary";
  } else {
    result.type = prop.type;
  }

  // Handle description
  if (prop.description) {
    result.description = prop.description;
  }

  // Handle enum
  if (prop.enum && Array.isArray(prop.enum)) {
    result.enum = prop.enum;
  }

  // Handle array items
  if (prop.type === "array" && prop.items) {
    result.items = propertyToJsonSchema(prop.items as Record<string, unknown>);
  }

  // Handle nested object properties
  if (prop.type === "object" && prop.properties) {
    const nestedProps: Record<string, object> = {};
    for (const [nestedName, nestedDef] of Object.entries(
      prop.properties as Record<string, Record<string, unknown>>
    )) {
      nestedProps[nestedName] = propertyToJsonSchema(nestedDef);
    }
    result.properties = nestedProps;
    if (prop.required) {
      result.required = prop.required;
    }
    result.additionalProperties = false;
  }

  return result;
}

/**
 * Generate a TypeScript interface for a single entity.
 */
export async function generateEntityInterface(entity: Entity): Promise<string> {
  const jsonSchema = entityToJsonSchema(entity);

  const ts = await compile(jsonSchema as Parameters<typeof compile>[0], entity.name, {
    bannerComment: "",
    additionalProperties: false,
    strictIndexSignatures: true,
    enableConstEnums: false,
    declareExternallyReferenced: false,
  });

  // Remove the export statement and clean up the output
  // json-schema-to-typescript outputs "export interface Name {...}"
  // We want just "export interface Name {...}" but formatted nicely
  return ts.trim();
}

/**
 * Generate all entity interfaces.
 */
export async function generateAllEntityInterfaces(entities: Entity[]): Promise<string> {
  if (entities.length === 0) {
    return "";
  }

  const interfaces: string[] = [];
  for (const entity of entities) {
    const iface = await generateEntityInterface(entity);
    interfaces.push(iface);
  }

  return interfaces.join("\n\n");
}

/**
 * Generate registry entries for entities.
 */
export function generateEntityRegistryEntries(entities: Entity[]): string {
  if (entities.length === 0) {
    return "";
  }

  return entities.map((e) => `    ${e.name}: ${e.name};`).join("\n");
}

/**
 * Generate registry entries for function names.
 */
export function generateFunctionRegistryEntries(functions: Function[]): string {
  if (functions.length === 0) {
    return "";
  }

  return functions.map((f) => `    ${f.name}: true;`).join("\n");
}

/**
 * Generate registry entries for agent names.
 */
export function generateAgentRegistryEntries(agents: AgentConfig[]): string {
  if (agents.length === 0) {
    return "";
  }

  return agents.map((a) => `    ${a.name}: true;`).join("\n");
}
