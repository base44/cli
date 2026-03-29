import type {
  Entity,
  PropertyDefinition,
} from "@/core/resources/entity/schema.js";

export type EntityRecord = Record<string, unknown>;

type ValidationErrorContext = {
  error_type: "ValidationError";
  message: string;
  request_id: null;
  traceback: "";
};

export class EntityValidationError extends Error {
  constructor(public context: ValidationErrorContext) {
    super(context.message);
  }
}

type ValidationResponse =
  | {
      hasError: false;
    }
  | {
      hasError: true;
      error: ValidationErrorContext;
    };

// https://docs.base44.com/developers/backend/resources/entities/entity-schemas#field-types
const fieldTypes = [
  "string",
  "integer",
  "number",
  "boolean",
  "array",
  "object",
];

export class Validator {
  /**
   * Filter out fields that are not supported by the schema
   */
  filterFields(record: EntityRecord, entitySchema: Entity): EntityRecord {
    const filteredRecord: EntityRecord = {};
    for (const [key, value] of Object.entries(record)) {
      if (entitySchema.properties[key]) {
        filteredRecord[key] = value;
      }
    }
    return filteredRecord;
  }

  applyDefaults(record: EntityRecord, entitySchema: Entity): EntityRecord {
    const result: EntityRecord = {};
    for (const [key, property] of Object.entries(entitySchema.properties)) {
      if (property.default !== undefined) {
        result[key] = property.default;
      }
    }
    return {
      ...result,
      ...record,
    };
  }

  /**
   * Validates whether record is correctly follow the schema
   */
  validate(
    record: EntityRecord,
    entitySchema: Entity,
    partial: boolean = false,
  ) {
    // Partial validation happening, when user updates existing entity.
    // In this case not all data will be passed.
    if (!partial) {
      const requiredFieldsResponse = this.validateRequiredFields(
        record,
        entitySchema,
      );
      if (requiredFieldsResponse.hasError) {
        throw new EntityValidationError(requiredFieldsResponse.error);
      }
    }
    const fieldTypesResponse = this.validateFieldTypes(record, entitySchema);
    if (fieldTypesResponse.hasError) {
      throw new EntityValidationError(fieldTypesResponse.error);
    }
  }

  private createValidationError(message: string): ValidationErrorContext {
    return {
      error_type: "ValidationError",
      message,
      request_id: null,
      traceback: "",
    };
  }

  /**
   * Validating field types according to documentation
   */
  private validateFieldTypes(
    record: EntityRecord,
    entitySchema: Entity,
  ): ValidationResponse {
    for (const [key, value] of Object.entries(record)) {
      const property = entitySchema.properties[key];
      const result = this.validateValue(value, property, key);
      if (result.hasError) return result;
    }

    return {
      hasError: false,
    };
  }

  private validateValue(
    value: unknown,
    property: PropertyDefinition | undefined,
    fieldPath: string,
  ): ValidationResponse {
    // Silently ignore fields not defined in the schema.
    // The expectation is that `filterFields()` will run before.
    if (!property) {
      return { hasError: false };
    }

    const propertyType = property.type;
    if (!fieldTypes.includes(propertyType)) {
      return {
        hasError: true,
        error: this.createValidationError(
          `Error in field ${fieldPath}: Unsupported field type ${propertyType}`,
        ),
      };
    }

    switch (propertyType) {
      case "array":
        if (!Array.isArray(value)) {
          return {
            hasError: true,
            error: this.createValidationError(
              `Error in field ${fieldPath}: Input should be a valid array`,
            ),
          };
        }
        if (property.items) {
          for (let i = 0; i < value.length; i++) {
            const itemResult = this.validateValue(
              value[i],
              property.items,
              `${fieldPath}[${i}]`,
            );
            if (itemResult.hasError) return itemResult;
          }
        }
        break;
      case "object":
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value)
        ) {
          return {
            hasError: true,
            error: this.createValidationError(
              `Error in field ${fieldPath}: Input should be a valid object`,
            ),
          };
        }
        if (property.properties) {
          for (const [subKey, subValue] of Object.entries(
            value as Record<string, unknown>,
          )) {
            if (property.properties[subKey]) {
              const subResult = this.validateValue(
                subValue,
                property.properties[subKey],
                `${fieldPath}.${subKey}`,
              );
              if (subResult.hasError) return subResult;
            }
          }
        }
        break;
      case "integer":
        if (!Number.isInteger(value)) {
          return {
            hasError: true,
            error: this.createValidationError(
              `Error in field ${fieldPath}: Input should be a valid integer`,
            ),
          };
        }
        break;
      default:
        if (typeof value !== propertyType) {
          return {
            hasError: true,
            error: this.createValidationError(
              `Error in field ${fieldPath}: Input should be a valid ${propertyType}`,
            ),
          };
        }
    }

    return { hasError: false };
  }

  private validateRequiredFields(
    record: EntityRecord,
    entitySchema: Entity,
  ): ValidationResponse {
    if (entitySchema.required && entitySchema.required.length > 0) {
      for (const required of entitySchema.required) {
        if (record[required] == null) {
          return {
            hasError: true,
            error: this.createValidationError(
              `Error in field ${required}: Field required`,
            ),
          };
        }
      }
    }
    return {
      hasError: false,
    };
  }
}
