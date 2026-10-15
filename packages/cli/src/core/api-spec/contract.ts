import type { ApiOperation } from "./operations.js";
import {
  MediaContentSchema,
  type OpenApiSpec,
  ParameterSchema,
  ResponseObjectSchema,
} from "./schema.js";

const SCHEMA_REF_PREFIX = "#/components/schemas/";
const MAX_REF_DEPTH = 4;
// FastAPI's 422 for any request that fails validation; the same on every operation.
const FRAMEWORK_VALIDATION_ERROR = "Validation Error";

/**
 * Replace component `$ref`s with their schemas so a contract reads on its own.
 * A cycle, an unknown ref, or nesting past MAX_REF_DEPTH keeps its `$ref`.
 */
function inlineRefs(
  node: unknown,
  schemas: Record<string, unknown>,
  seen: ReadonlySet<string> = new Set(),
  depth = 0,
): unknown {
  if (depth > MAX_REF_DEPTH) {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => inlineRefs(item, schemas, seen, depth));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const { $ref, ...siblings } = node as Record<string, unknown>;
  if (typeof $ref === "string" && $ref.startsWith(SCHEMA_REF_PREFIX)) {
    const name = $ref.slice(SCHEMA_REF_PREFIX.length);
    if (seen.has(name) || !(name in schemas)) {
      return node;
    }
    const resolved = inlineRefs(
      schemas[name],
      schemas,
      new Set([...seen, name]),
      depth + 1,
    );
    // OpenAPI 3.1: keys beside a $ref (description, ...) override the target's.
    return resolved !== null && typeof resolved === "object"
      ? { ...resolved, ...siblings }
      : resolved;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      inlineRefs(value, schemas, seen, depth),
    ]),
  );
}

/** A body's media type and schema: JSON when offered, else the first (e.g. a multipart upload). */
function bodyOf(value: unknown): { contentType?: string; schema?: unknown } {
  const parsed = MediaContentSchema.safeParse(value);
  const content = parsed.success ? (parsed.data.content ?? {}) : {};
  const contentType =
    "application/json" in content
      ? "application/json"
      : Object.keys(content)[0];
  return contentType
    ? { contentType, schema: content[contentType]?.schema }
    : {};
}

/** Schemas still referenced after inlining (cycles, depth), so every `$ref` resolves. */
function leftoverRefs(
  node: unknown,
  schemas: Record<string, unknown>,
  found: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  if (Array.isArray(node)) {
    for (const item of node) {
      leftoverRefs(item, schemas, found);
    }
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "$ref" &&
        typeof value === "string" &&
        value.startsWith(SCHEMA_REF_PREFIX) &&
        !found.has(value)
      ) {
        const schema = schemas[value.slice(SCHEMA_REF_PREFIX.length)];
        // A ref to a schema the spec lacks has nothing to list.
        if (schema !== undefined) {
          found.set(value, schema);
          leftoverRefs(schema, schemas, found);
        }
      } else {
        leftoverRefs(value, schemas, found);
      }
    }
  }
  return found;
}

// Keys whose values are data, not schemas: never strip a `title` inside them.
const SCHEMA_DATA_KEYS = new Set([
  "example",
  "examples",
  "default",
  "enum",
  "const",
]);

// Docs-site markup: Mintlify callouts and links relative to the docs site.
const DOCS_CALLOUT = /<(Info|Note|Tip|Check|Warning)>([\s\S]*?)<\/\1>/g;
const RELATIVE_LINK = /\[([^\]]+)\]\(\/[^)]*\)/g;

/** Description text without docs-site markup an agent can't use. */
function cleanText(text: string): string {
  return text
    .replace(DOCS_CALLOUT, (_, kind: string, body: string) =>
      kind === "Warning" ? `Warning: ${body}` : body,
    )
    .replace(RELATIVE_LINK, "$1");
}

/**
 * A schema without FastAPI's generated `title`s, with `anyOf: [X, null]`
 * written as `type: [X, "null"]`, and with cleaned descriptions. Keys inside
 * `properties` are field names, so a field called `title` stays.
 */
function slimSchema(node: unknown, isPropertyMap = false): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => slimSchema(item));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const entries = Object.entries(node as Record<string, unknown>);
  if (isPropertyMap) {
    return Object.fromEntries(
      entries.map(([name, value]) => [name, slimSchema(value)]),
    );
  }
  const slim: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key === "title" && typeof value === "string") {
      continue;
    }
    slim[key] = SCHEMA_DATA_KEYS.has(key)
      ? value
      : key === "properties"
        ? slimSchema(value, true)
        : key === "description" && typeof value === "string"
          ? cleanText(value)
          : slimSchema(value);
  }
  const { anyOf, ...rest } = slim;
  const nullable =
    Array.isArray(anyOf) && anyOf.length === 2
      ? nullableType(anyOf as unknown[])
      : undefined;
  return nullable ? { type: [nullable, "null"], ...rest } : slim;
}

/** `string` for `[{type: "string"}, {type: "null"}]`, in either order. */
function nullableType(variants: unknown[]): string | undefined {
  const types = variants.map((variant) =>
    variant !== null &&
    typeof variant === "object" &&
    Object.keys(variant).length === 1 &&
    typeof (variant as { type?: unknown }).type === "string"
      ? (variant as { type: string }).type
      : undefined,
  );
  if (types.includes(undefined) || !types.includes("null")) {
    return undefined;
  }
  return types.find((type) => type !== "null");
}

/**
 * The operation's contract: what a caller needs to build the request and read
 * the result. Error responses keep only their descriptions.
 */
export function getOperationContract(spec: OpenApiSpec, op: ApiOperation) {
  const schemas = spec.components?.schemas ?? {};
  const inline = (node: unknown) =>
    node === undefined ? null : slimSchema(inlineRefs(node, schemas));
  const responses = Object.entries(op.operation.responses ?? {}).flatMap(
    ([status, response]) => {
      const parsed = ResponseObjectSchema.safeParse(response);
      return parsed.success ? [[status, parsed.data] as const] : [];
    },
  );
  const success = responses
    .filter(([status]) => status.startsWith("2"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, response]) => bodyOf(response).schema)
    .find(Boolean);
  const errors = responses.filter(
    ([status, response]) =>
      !status.startsWith("2") &&
      response.description !== FRAMEWORK_VALIDATION_ERROR,
  );
  const requestBody = bodyOf(op.operation.requestBody);
  const contract = {
    endpoint: op.endpoint,
    method: op.method,
    path: op.path,
    summary: op.summary,
    description: cleanText(op.description),
    parameters: (op.operation.parameters ?? []).flatMap((parameter) => {
      const parsed = ParameterSchema.safeParse(parameter);
      if (!parsed.success) {
        return [];
      }
      const { name, in: location, required, schema, description } = parsed.data;
      // FastAPI repeats the description inside the schema; keep one copy.
      const inSchema =
        schema !== null &&
        typeof schema === "object" &&
        "description" in schema;
      return [
        {
          name,
          in: location,
          required: required ?? false,
          schema: inline(schema ?? {}),
          ...(description && !inSchema
            ? { description: cleanText(description) }
            : {}),
          ...("example" in parsed.data ? { example: parsed.data.example } : {}),
        },
      ];
    }),
    ...(requestBody.contentType &&
    requestBody.contentType !== "application/json"
      ? { requestBodyContentType: requestBody.contentType }
      : {}),
    requestBodySchema: inline(requestBody.schema),
    responseSchema: inline(success),
    errors: Object.fromEntries(
      errors.map(([status, response]) => [
        status,
        cleanText(response.description ?? ""),
      ]),
    ),
  };
  const refs = leftoverRefs(contract, schemas);
  return {
    ...contract,
    ...(refs.size > 0
      ? {
          refs: Object.fromEntries(
            [...refs].map(([ref, schema]) => [ref, slimSchema(schema)]),
          ),
        }
      : {}),
  };
}
