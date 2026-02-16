import { z } from "zod";

const FieldConditionSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.looseObject({
    $in: z.unknown().optional(),
    $nin: z.unknown().optional(),
    $ne: z.unknown().optional(),
    $all: z.unknown().optional(),
  }),
]);

const userConditionAllowedKeys = new Set(["role", "email", "id"]);

const UserConditionSchema = z
  .looseObject({
    role: z.string().optional(),
    email: z.string().optional(),
    id: z.string().optional(),
  })
  .refine(
    (val) =>
      Object.keys(val).every(
        (key) => userConditionAllowedKeys.has(key) || key.startsWith("data."),
      ),
    "Keys must be role, email, id, or match data.* pattern",
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

const fieldConditionOperators = new Set(["$in", "$nin", "$ne", "$all"]);

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

const RLSRuleSchema = z.union([z.boolean(), RefineRLSConditionSchema]);

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

const PropertyDefinitionSchema: z.ZodType<unknown> = z.looseObject({
  type: z.string().optional(),
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
  get items(): z.ZodOptional<z.ZodType<unknown>> {
    return PropertyDefinitionSchema.optional();
  },
  get properties(): z.ZodOptional<
    z.ZodRecord<z.ZodString, z.ZodType<unknown>>
  > {
    return z.record(z.string(), PropertyDefinitionSchema).optional();
  },
});

export const EntitySchema = z.looseObject({
  type: z.literal("object").default("object"),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9]+$/, "Entity name must be alphanumeric only"),
  title: z.string().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), PropertyDefinitionSchema).default({}),
  required: z.array(z.string()).optional(),
  rls: EntityRLSSchema.optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

export const SyncEntitiesResponseSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});

export type SyncEntitiesResponse = z.infer<typeof SyncEntitiesResponseSchema>;
