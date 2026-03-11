import type { Entity } from "@/core/resources/entity/schema.js";

export type EntityRecord = Record<string, unknown>;

type ValidationError = {
  error_type: "ValidationError";
  message: string;
  request_id: null;
  traceback: "";
};

type ValidationResponse =
  | {
      hasError: false;
    }
  | {
      hasError: true;
      error: ValidationError;
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
    for (const [key, property] of Object.entries(entitySchema.properties) as [
      string,
      // biome-ignore lint/suspicious/noExplicitAny: we don't need to write types for everything in `dev`
      any,
    ]) {
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
  ): ValidationResponse {
    // Partial validation happening, when user updates existing entity.
    // In this case not all data will be passed.
    if (!partial) {
      const requiredFieldsResponse = this.validateRequiredFields(
        record,
        entitySchema,
      );
      if (requiredFieldsResponse.hasError) {
        return requiredFieldsResponse;
      }
    }
    const fieldTypesResponse = this.validateFieldTypes(record, entitySchema);
    if (fieldTypesResponse.hasError) {
      return fieldTypesResponse;
    }
    return {
      hasError: false,
    };
  }

  private createValidationError(message: string): ValidationError {
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
      // biome-ignore lint/suspicious/noExplicitAny: we don't need to write types for everything in `dev`
      const property = entitySchema.properties[key] as any;
      const result = this.validateValue(value, property, key);
      if (result.hasError) return result;
    }

    return {
      hasError: false,
    };
  }

  private validateValue(
    value: unknown,
    // biome-ignore lint/suspicious/noExplicitAny: we don't need to write types for everything in `dev`
    property: any,
    fieldPath: string,
  ): ValidationResponse {
    const propertyType = property?.type;
    if (!fieldTypes.includes(propertyType)) {
      return {
        hasError: true,
        error: this.createValidationError(
          `Error in field ${fieldPath}: Input should be a valid ${propertyType}`,
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
