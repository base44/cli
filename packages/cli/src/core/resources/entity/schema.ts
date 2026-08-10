import { z } from "zod";
import { ResourceSourceSchema } from "@/core/resources/types.js";

// This file mirrors the platform's contract; it must never be stricter. The
// authority is backend/app/user_apps/entities/rls_validation.py
// (SUPPORTED_FIELD_OPERATORS, OPEN_RULE_VALUES, _user_condition_valid) plus
// backend/app/json_schema_utils.py (validate_json_schema). A stricter rule here
// rejects apps that production accepts and evaluates, and it fails the *whole*
// project read — so an unrelated entity file blocks every command.
const FieldConditionSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.looseObject({}),
]);

// The engine compares user attributes by exact equality; it constrains neither
// the attribute names nor their scalar types, so neither do we.
const UserConditionSchema = z.looseObject({});

const rlsConditionAllowedKeys = new Set([
  "user_condition",
  "created_by",
  "created_by_id",
  "id",
  "_id",
  "created_date",
  "updated_date",
  "app_id",
  "entity_name",
  "is_deleted",
  "deleted_date",
  "environment",
  "$or",
  "$and",
  "$nor",
]);

const RLSConditionSchema = z.looseObject({
  user_condition: UserConditionSchema.optional(),
  created_by: FieldConditionSchema.optional(),
  created_by_id: FieldConditionSchema.optional(),
  get $or(): z.ZodOptional<z.ZodArray<typeof RLSConditionSchema>> {
    return z.array(RefineRLSConditionSchema).optional();
  },
  get $and(): z.ZodOptional<z.ZodArray<typeof RLSConditionSchema>> {
    return z.array(RefineRLSConditionSchema).optional();
  },
  get $nor(): z.ZodOptional<z.ZodArray<typeof RLSConditionSchema>> {
    return z.array(RefineRLSConditionSchema).optional();
  },
});

// Mirrors SUPPORTED_FIELD_OPERATORS in rls_validation.py.
const fieldConditionOperators = new Set([
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$exists",
  "$all",
  "$size",
  "$elemMatch",
]);

const isValidFieldCondition = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "object") {
    return Object.keys(value).every((k) => fieldConditionOperators.has(k));
  }
  return false;
};

const RefineRLSConditionSchema = RLSConditionSchema.refine(
  (val) =>
    Object.entries(val).every(
      ([key, value]) =>
        rlsConditionAllowedKeys.has(key) || isValidFieldCondition(value),
    ),
  "Field condition values must be a primitive or an operator object ($in, $nin, $ne, $all)",
);

// OPEN_RULE_VALUES in rls_validation.py: null, true, {}, "" all mean "open".
const RLSRuleSchema = z.union([
  z.boolean(),
  z.null(),
  z.literal(""),
  RefineRLSConditionSchema,
]);

const EntityRLSSchema = z.looseObject({
  create: RLSRuleSchema.optional(),
  read: RLSRuleSchema.optional(),
  update: RLSRuleSchema.optional(),
  delete: RLSRuleSchema.optional(),
  write: RLSRuleSchema.optional(),
});

const FieldRLSSchema = z.looseObject({
  read: RLSRuleSchema.optional(),
  write: RLSRuleSchema.optional(),
  create: RLSRuleSchema.optional(),
  update: RLSRuleSchema.optional(),
  delete: RLSRuleSchema.optional(),
});

export const PropertyDefinitionSchema = z.looseObject({
  // JSON Schema allows a union (`["string", "null"]`), and validate_json_schema
  // only requires the key to be present.
  type: z.union([z.string(), z.array(z.string())]),
  title: z.string().optional(),
  description: z.string().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  pattern: z.string().optional(),
  format: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(z.unknown()).optional(),
  enumNames: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  $ref: z.string().optional(),
  rls: FieldRLSSchema.optional(),
  required: z.array(z.string()).optional(),
  get items() {
    return PropertyDefinitionSchema.optional();
  },
  get properties() {
    return z.record(z.string(), PropertyDefinitionSchema).optional();
  },
});

export type PropertyDefinition = z.infer<typeof PropertyDefinitionSchema>;

export const EntitySchema = z.looseObject({
  type: z.literal("object").default("object"),
  name: z
    .string()
    .min(1)
    // ENTITY_NAME_PATTERN in backend/app/user_apps/common/entity_name_validation.py.
    .regex(
      /^\w+$/,
      "Entity name must contain only letters, numbers, and underscores",
    ),
  title: z.string().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), PropertyDefinitionSchema).default({}),
  required: z.array(z.string()).optional(),
  rls: EntityRLSSchema.optional(),
  source: ResourceSourceSchema.default({ type: "project" }),
});

export type Entity = z.infer<typeof EntitySchema>;

export const SyncEntitiesResponseSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});

export type SyncEntitiesResponse = z.infer<typeof SyncEntitiesResponseSchema>;
