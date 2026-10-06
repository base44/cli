import type { Entity } from "@/core/resources/entity/schema.js";

/**
 * Gets a value from a flat RLS source, handling `data.*` field references.
 * Entity and user data fields are stored flat, so `data.department`
 * maps to `source.department`.
 */
function getRLSFieldValue(
  key: string,
  source: Record<string, unknown>,
): unknown {
  const DATA_FIELD_PREFIX = "data.";

  return source[
    key.startsWith(DATA_FIELD_PREFIX)
      ? key.slice(DATA_FIELD_PREFIX.length)
      : key
  ];
}

/**
 * Resolves template variables like {{user.email}} in RLS condition values.
 * User fields: email, id, role are accessed directly.
 * data.* fields are accessed by stripping the "data." prefix.
 */
function resolveTemplate(value: string, user: Record<string, unknown>): string {
  return value.replace(/\{\{user\.([\w.]+)\}\}/g, (_match, path: string) => {
    return String(getRLSFieldValue(path, user) ?? "");
  });
}

/**
 * Evaluates field-level operators ($in, $nin, $ne, $all).
 */
function evaluateOperator(
  recordValue: unknown,
  operator: Record<string, unknown>,
): boolean {
  for (const [op, opValue] of Object.entries(operator)) {
    switch (op) {
      case "$in":
        if (!Array.isArray(opValue) || !opValue.includes(recordValue)) {
          return false;
        }
        break;
      case "$nin":
        if (!Array.isArray(opValue) || opValue.includes(recordValue)) {
          return false;
        }
        break;
      case "$ne":
        if (recordValue === opValue) return false;
        break;
      case "$all":
        if (!Array.isArray(recordValue) || !Array.isArray(opValue)) {
          return false;
        }
        if (!opValue.every((v) => (recordValue as unknown[]).includes(v))) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  return true;
}

/**
 * Evaluates a user_condition check against user properties.
 */
function evaluateUserCondition(
  condition: Record<string, unknown>,
  user: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(condition)) {
    const userValue = getRLSFieldValue(key, user);

    if (typeof expected === "object" && expected !== null) {
      if (!evaluateOperator(userValue, expected as Record<string, unknown>))
        return false;
    } else {
      if (userValue !== expected) return false;
    }
  }
  return true;
}

/**
 * Evaluates an RLS condition object against a record and user.
 * Supports: user_condition, field comparisons with templates,
 * logical operators ($or, $and, $nor), and field operators ($in, $nin, $ne, $all).
 */
function evaluateCondition(
  condition: Record<string, unknown>,
  record: Record<string, unknown>,
  user: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(condition)) {
    if (key === "user_condition") {
      if (!evaluateUserCondition(value as Record<string, unknown>, user))
        return false;
      continue;
    }

    if (key === "$or") {
      const conditions = value as Record<string, unknown>[];
      if (!conditions.some((c) => evaluateCondition(c, record, user)))
        return false;
      continue;
    }

    if (key === "$and") {
      const conditions = value as Record<string, unknown>[];
      if (!conditions.every((c) => evaluateCondition(c, record, user)))
        return false;
      continue;
    }

    if (key === "$nor") {
      const conditions = value as Record<string, unknown>[];
      if (conditions.some((c) => evaluateCondition(c, record, user)))
        return false;
      continue;
    }

    // Field comparison: resolve templates in string values, then compare
    const recordValue = getRLSFieldValue(key, record);
    const resolvedValue =
      typeof value === "string" ? resolveTemplate(value, user) : value;

    if (typeof resolvedValue === "object" && resolvedValue !== null) {
      if (
        !evaluateOperator(recordValue, resolvedValue as Record<string, unknown>)
      )
        return false;
    } else {
      if (recordValue !== resolvedValue) return false;
    }
  }

  return true;
}

/**
 * Checks if an operation is allowed by an RLS rule.
 * - undefined/true → allow
 * - false → deny
 * - condition object → evaluate against record and user
 */
export function checkRLS(
  rule: boolean | Record<string, unknown> | null | "" | undefined,
  record: Record<string, unknown>,
  user: Record<string, unknown> | undefined,
): boolean {
  if (user?.is_service === true) return true;
  if (rule === undefined || rule === null || rule === "") return true;
  if (typeof rule === "object" && Object.keys(rule).length === 0) return true;
  if (typeof rule === "boolean") return rule;
  if (!user) return false;
  return evaluateCondition(rule, record, user);
}

/**
 * Applies field-level security by filtering out fields the user
 * doesn't have permission to access for the given operation.
 */
export function applyFLS(
  record: Record<string, unknown>[],
  schema: Entity,
  user: Record<string, unknown> | undefined,
  operation: "read" | "write",
): Record<string, unknown>[];
export function applyFLS(
  record: Record<string, unknown>,
  schema: Entity,
  user: Record<string, unknown> | undefined,
  operation: "read" | "write",
): Record<string, unknown>;
export function applyFLS(
  record: Record<string, unknown> | Record<string, unknown>[],
  schema: Entity,
  user: Record<string, unknown> | undefined,
  operation: "read" | "write",
): Record<string, unknown> | Record<string, unknown>[] {
  if (Array.isArray(record)) {
    return record.map((r) => applyFLS(r, schema, user, operation));
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const rule = schema.properties[key]?.rls?.[operation];
    if (rule === undefined || checkRLS(rule, record, user)) {
      result[key] = value;
    }
  }
  return result;
}
