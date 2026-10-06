import type { PropertyDefinition } from "@/core/resources/entity/schema.js";

type FieldRLS = NonNullable<PropertyDefinition["rls"]>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const flattenToDataPaths = (
  record: Record<string, unknown>,
  prefix = "data",
): [string, unknown][] =>
  Object.entries(record).flatMap(([key, value]) =>
    isPlainObject(value)
      ? flattenToDataPaths(value, `${prefix}.${key}`)
      : [[`${prefix}.${key}`, value]],
  );

export const collectFieldRules = (
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

export const findClosestRule = (rules: Map<string, FieldRLS>, path: string) => {
  const segments = path.split(".");
  for (let length = segments.length; length > 1; length--) {
    const rule = rules.get(segments.slice(0, length).join("."));
    if (rule) return rule;
  }
  return undefined;
};
