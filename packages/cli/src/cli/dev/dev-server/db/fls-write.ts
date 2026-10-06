import { isDeepStrictEqual } from "node:util";
import { checkRLS } from "@/cli/dev/dev-server/db/rls.js";
import type {
  Entity,
  PropertyDefinition,
} from "@/core/resources/entity/schema.js";

export class FLSWriteError extends Error {
  constructor(operation: "create" | "update", deniedFields: string[]) {
    const verb = operation === "create" ? "set" : "modify";
    super(
      `You're not allowed to ${verb} the following fields: ${deniedFields.join(", ")}`,
    );
  }
}

type FieldRLS = NonNullable<PropertyDefinition["rls"]>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const flattenToDataPaths = (
  record: Record<string, unknown>,
  prefix = "data",
): [string, unknown][] =>
  Object.entries(record).flatMap(([key, value]) =>
    isPlainObject(value)
      ? flattenToDataPaths(value, `${prefix}.${key}`)
      : [[`${prefix}.${key}`, value]],
  );

const collectFieldRules = (
  properties: Record<string, PropertyDefinition>,
  prefix = "data",
): [string, FieldRLS][] =>
  Object.entries(properties).flatMap(([key, property]) => {
    const path = `${prefix}.${key}`;
    const own: [string, FieldRLS][] = property.rls
      ? [[path, property.rls]]
      : [];
    return [...own, ...collectFieldRules(property.properties ?? {}, path)];
  });

const findClosestRule = (rules: Map<string, FieldRLS>, path: string) => {
  const segments = path.split(".");
  for (let length = segments.length; length > 1; length--) {
    const rule = rules.get(segments.slice(0, length).join("."));
    if (rule) return rule;
  }
  return undefined;
};

const isUnchanged = (before: unknown, after: unknown) =>
  isDeepStrictEqual(before ?? null, after ?? null);

/**
 * Rejects the whole write if any changed field is protected, like production:
 * values are compared per nested path (a missing value equals null), a nested
 * path falls under its closest rule, and rules are evaluated against `context`
 * (the existing record on update, the owner fields on create).
 */
export function assertFLSWrite(
  changes: Record<string, unknown>,
  context: Record<string, unknown>,
  schema: Entity,
  user: Record<string, unknown> | undefined,
  operation: "create" | "update",
): void {
  const rules = new Map(collectFieldRules(schema.properties));
  const before = new Map(flattenToDataPaths(context));
  const denied = flattenToDataPaths(changes)
    .filter(([path, value]) => {
      const rls = findClosestRule(rules, path);
      const rule = rls?.[operation] ?? rls?.write;
      return (
        rule !== undefined &&
        !isUnchanged(before.get(path), value) &&
        !checkRLS(rule, context, user)
      );
    })
    .map(([path]) => path);
  if (denied.length > 0) {
    throw new FLSWriteError(operation, denied);
  }
}
