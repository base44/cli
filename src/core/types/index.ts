export {
  generateEntityInterface,
  generateAllEntityInterfaces,
  generateEntityRegistryEntries,
  generateFunctionRegistryEntries,
  generateAgentRegistryEntries,
  type TypesInput,
  type TypesOptions,
  type TypesResult,
} from "./generator.js";

export { generateTypesFileContent, type TemplateInput } from "./template.js";

export {
  generateAgentJsonSchema,
  generateEntityJsonSchema,
  generateFunctionJsonSchema,
  generateAllJsonSchemas,
  type SchemaGeneratorInput,
  type GeneratedSchemas,
} from "./json-schema-generator.js";

export {
  writeAllTypesFiles,
  type WriteTypesInput,
  type WriteTypesOptions,
  type WriteTypesResult,
} from "./write.js";
