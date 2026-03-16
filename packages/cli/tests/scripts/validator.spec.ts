import { describe, expect, it } from "vitest";
import {
  type EntityRecord,
  Validator,
} from "../../src/cli/dev/dev-server/db/validator.js";
import type { Entity } from "../../src/core/resources/entity/schema.js";

function makeEntity(
  properties: Record<string, unknown>,
  required?: string[],
): Entity {
  return {
    type: "object",
    name: "TestEntity",
    properties,
    ...(required ? { required } : {}),
  } as Entity;
}

describe("Validator", () => {
  const validator = new Validator();

  describe("filterFields", () => {
    it("should keep only fields defined in the schema", () => {
      const schema = makeEntity({
        name: { type: "string" },
        age: { type: "integer" },
      });
      const record: EntityRecord = {
        name: "Alice",
        age: 30,
        extra: "should be removed",
      };

      const result = validator.filterFields(record, schema);

      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    it("should return empty object when record has no matching fields", () => {
      const schema = makeEntity({ name: { type: "string" } });
      const record: EntityRecord = { unknown: "value" };

      expect(validator.filterFields(record, schema)).toEqual({});
    });

    it("should return empty object for empty record", () => {
      const schema = makeEntity({ name: { type: "string" } });

      expect(validator.filterFields({}, schema)).toEqual({});
    });
  });

  describe("applyDefaults", () => {
    it("should fill in default values for missing fields", () => {
      const schema = makeEntity({
        status: { type: "string", default: "active" },
        priority: { type: "integer", default: 1 },
      });

      const result = validator.applyDefaults({}, schema);

      expect(result).toEqual({ status: "active", priority: 1 });
    });

    it("record values should override defaults", () => {
      const schema = makeEntity({
        status: { type: "string", default: "active" },
      });

      const result = validator.applyDefaults({ status: "inactive" }, schema);

      expect(result).toEqual({ status: "inactive" });
    });

    it("should not add defaults for fields without a default", () => {
      const schema = makeEntity({
        name: { type: "string" },
        status: { type: "string", default: "active" },
      });

      const result = validator.applyDefaults({}, schema);

      expect(result).toEqual({ status: "active" });
    });
  });

  describe("validate", () => {
    it("should pass when all required fields are present", () => {
      const schema = makeEntity({ name: { type: "string" } }, ["name"]);

      const result = validator.validate({ name: "Alice" }, schema);

      expect(result.hasError).toBe(false);
    });

    it("should fail when a required field is missing", () => {
      const schema = makeEntity({ name: { type: "string" } }, ["name"]);

      const result = validator.validate({}, schema);

      expect(result.hasError).toBe(true);
      if (result.hasError) {
        expect(result.error.message).toContain("name");
        expect(result.error.message).toContain("Field required");
      }
    });

    describe("field types", () => {
      it("should pass for valid string field", () => {
        const schema = makeEntity({ name: { type: "string" } });

        const result = validator.validate({ name: "Alice" }, schema);

        expect(result.hasError).toBe(false);
      });

      it("should fail when string field gets a number", () => {
        const schema = makeEntity({ name: { type: "string" } });

        const result = validator.validate({ name: 123 }, schema);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error.message).toContain("name");
          expect(result.error.message).toContain("string");
        }
      });

      it("passes for valid boolean field", () => {
        const schema = makeEntity({ active: { type: "boolean" } });

        const result = validator.validate({ active: true }, schema);

        expect(result.hasError).toBe(false);
      });

      it("should fail when boolean field gets a string", () => {
        const schema = makeEntity({ active: { type: "boolean" } });

        const result = validator.validate({ active: "yes" }, schema);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error.message).toContain("boolean");
        }
      });

      it("should pass for valid number field", () => {
        const schema = makeEntity({ score: { type: "number" } });

        const result = validator.validate({ score: 3.14 }, schema);

        expect(result.hasError).toBe(false);
      });

      it("should pass for valid integer field", () => {
        const schema = makeEntity({ score: { type: "integer" } });

        const result = validator.validate({ score: 3 }, schema);

        expect(result.hasError).toBe(false);
      });

      it("should fail for invalid integer field", () => {
        const schema = makeEntity({ score: { type: "integer" } });

        const result = validator.validate({ score: 3.3333 }, schema);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error.message).toContain("integer");
        }
      });

      it("should pass for valid array field", () => {
        const schema = makeEntity({ tags: { type: "array" } });

        const result = validator.validate({ tags: ["a", "b"] }, schema);

        expect(result.hasError).toBe(false);
      });

      it("should fail when array field gets a non-array", () => {
        const schema = makeEntity({ tags: { type: "array" } });

        const result = validator.validate({ tags: "not-array" }, schema);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error.message).toContain("array");
        }
      });

      it("should fail when array field gets a object", () => {
        const schema = makeEntity({ tags: { type: "array" } });

        const result = validator.validate({ tags: {} }, schema);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error.message).toContain("array");
        }
      });

      it("should pass for valid object field", () => {
        const schema = makeEntity({ meta: { type: "object" } });

        const result = validator.validate({ meta: { key: "val" } }, schema);

        expect(result.hasError).toBe(false);
      });

      describe("array items validation", () => {
        it("should pass for array with valid string items", () => {
          const schema = makeEntity({
            tags: { type: "array", items: { type: "string" } },
          });

          const result = validator.validate({ tags: ["a", "b"] }, schema);

          expect(result.hasError).toBe(false);
        });

        it("should fail when array item has wrong type", () => {
          const schema = makeEntity({
            tags: { type: "array", items: { type: "string" } },
          });

          const result = validator.validate({ tags: ["a", 42] }, schema);

          expect(result.hasError).toBe(true);
          if (result.hasError) {
            expect(result.error.message).toContain("tags[1]");
            expect(result.error.message).toContain("string");
          }
        });

        // This one is temporary, and is here only because poduction is not there yet.
        it("should skip item validation when items is not defined", () => {
          const schema = makeEntity({ tags: { type: "array" } });

          const result = validator.validate(
            { tags: [1, "mixed", true] },
            schema,
          );

          expect(result.hasError).toBe(false);
        });

        it("should validate array of objects recursively", () => {
          const schema = makeEntity({
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  count: { type: "integer" },
                },
              },
            },
          });

          const passing = validator.validate(
            { entries: [{ name: "x", count: 1 }] },
            schema,
          );
          expect(passing.hasError).toBe(false);

          const failing = validator.validate(
            { entries: [{ name: "x", count: 1.5 }] },
            schema,
          );
          expect(failing.hasError).toBe(true);
          if (failing.hasError) {
            expect(failing.error.message).toContain("entries[0].count");
            expect(failing.error.message).toContain("integer");
          }
        });
      });

      describe("object properties validation", () => {
        it("should validate nested object properties", () => {
          const schema = makeEntity({
            data: {
              type: "object",
              properties: {
                name: { type: "string" },
                count: { type: "integer" },
              },
            },
          });

          const passing = validator.validate(
            { data: { name: "x", count: 1 } },
            schema,
          );
          expect(passing.hasError).toBe(false);

          const failing = validator.validate({ data: { name: 123 } }, schema);
          expect(failing.hasError).toBe(true);
          if (failing.hasError) {
            expect(failing.error.message).toContain("data.name");
            expect(failing.error.message).toContain("string");
          }
        });

        // This one is temporary, and is here only because poduction is not there yet.
        it("should skip property validation when properties is not defined", () => {
          const schema = makeEntity({ meta: { type: "object" } });

          const result = validator.validate(
            { meta: { anything: 123, goes: true } },
            schema,
          );

          expect(result.hasError).toBe(false);
        });

        it("should ignore keys not in the schema properties", () => {
          const schema = makeEntity({
            data: {
              type: "object",
              properties: { name: { type: "string" } },
            },
          });

          const result = validator.validate(
            { data: { name: "ok", extra: 999 } },
            schema,
          );

          expect(result.hasError).toBe(false);
        });
      });

      it("should silently ignore fields not defined in the schema", () => {
        const schema = makeEntity({ name: { type: "string" } });
        const record: EntityRecord = { name: "Alice", extra: "not in schema" };

        const result = validator.validate(record, schema);

        expect(result.hasError).toBe(false);
      });

      it("should fail for unsupported field type", () => {
        const schema = makeEntity({ field: { type: "date" } });

        const result = validator.validate({ field: "2024-01-01" }, schema);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error.message).toContain("Unsupported field type date");
        }
      });
    });

    describe("partial validation", () => {
      it("should skip required field check when partial is true", () => {
        const schema = makeEntity({ name: { type: "string" } }, ["name"]);

        const result = validator.validate({}, schema, true);

        expect(result.hasError).toBe(false);
      });

      it("should still validate field types when partial is true", () => {
        const schema = makeEntity({ name: { type: "string" } }, ["name"]);

        const result = validator.validate({ name: 123 }, schema, true);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error.message).toContain("string");
        }
      });
    });

    describe("validation error shape", () => {
      it("should return properly shaped ValidationError", () => {
        const schema = makeEntity({ name: { type: "string" } }, ["name"]);

        const result = validator.validate({}, schema);

        expect(result.hasError).toBe(true);
        if (result.hasError) {
          expect(result.error).toEqual({
            error_type: "ValidationError",
            message: expect.stringContaining("name"),
            request_id: null,
            traceback: "",
          });
        }
      });
    });
  });
});
