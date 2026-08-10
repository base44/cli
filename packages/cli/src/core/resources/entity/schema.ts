import { z } from "zod";
import { ResourceSourceSchema } from "@/core/resources/types.js";

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

const isScalar = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

const isValidFieldCondition = (value: unknown): boolean => {
  if (isScalar(value)) {
    return true;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object).every((k) =>
      fieldConditionOperators.has(k),
    );
  }
  return false;
};

const supportedOperators = [...fieldConditionOperators].sort().join(", ");

const FieldConditionSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.looseObject({})])
  .refine(
    isValidFieldCondition,
    `Field condition values must be a primitive or an operator object (${supportedOperators})`,
  );

const UserConditionSchema = z
  .looseObject({})
  .refine(
    (val) =>
      Object.keys(val).length > 0 &&
      Object.entries(val).every(
        ([key, value]) => !key.startsWith("$") && isScalar(value),
      ),
    "user_condition compares user attributes by exact equality: a non-empty object of attribute: scalar pairs, no operators",
  );

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

const RefineRLSConditionSchema = RLSConditionSchema.refine(
  (val) =>
    Object.entries(val).every(
      ([key, value]) =>
        rlsConditionAllowedKeys.has(key) || isValidFieldCondition(value),
    ),
  `Field condition values must be a primitive or an operator object (${supportedOperators})`,
);

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
