import {
  HTTP_METHODS,
  type OpenApiOperation,
  type OpenApiSpec,
  ParameterSchema,
  RequestBodySchema,
  ResponseObjectSchema,
} from "./schema.js";

const PERSONAL_ACCESS_TOKEN_SCHEME = "PersonalAccessTokenAuth";
const READ_ONLY_SCOPE = "read_only";

export interface ApiOperation {
  /** `METHOD /path/template`, the operation's identity in every command's output. */
  endpoint: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  /** Parameter names and descriptions, for search. */
  parameterText: string;
  readOnly: boolean;
  operation: OpenApiOperation;
}

/** Read-only means a read-only personal access token may call it (the backend's `@read_safe`). */
function isReadOnly(operation: OpenApiOperation, spec: OpenApiSpec): boolean {
  const security = operation.security ?? spec.security ?? [];
  return security.some((requirement) =>
    requirement[PERSONAL_ACCESS_TOKEN_SCHEME]?.includes(READ_ONLY_SCOPE),
  );
}

function parameterText(operation: OpenApiOperation): string {
  return (operation.parameters ?? [])
    .flatMap((parameter) => {
      const parsed = ParameterSchema.safeParse(parameter);
      return parsed.success
        ? [parsed.data.name, parsed.data.description ?? ""]
        : [];
    })
    .join(" ");
}

export function listOperations(spec: OpenApiSpec): ApiOperation[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = item[method];
      if (!operation) {
        return [];
      }
      return [
        {
          endpoint: `${method.toUpperCase()} ${path}`,
          method: method.toUpperCase(),
          path,
          summary: operation.summary ?? "",
          description: operation.description ?? "",
          parameterText: parameterText(operation),
          readOnly: isReadOnly(operation, spec),
          operation,
        },
      ];
    }),
  );
}

function pathSegments(path: string): string[] {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  return pathname.split("/").filter(Boolean);
}

function segmentPattern(segment: string): RegExp {
  const source = segment
    .split(/(\{[^}]+\})/)
    .map((part) =>
      part.startsWith("{")
        ? "[^/]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`);
}

/** 1 per fully literal segment, so `/workflows/runs` outranks `/workflows/{workflow_id}`. */
function specificity(templateSegments: string[]): number[] {
  return templateSegments.map((segment) => (segment.includes("{") ? 0 : 1));
}

function compareSpecificity(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return (b[i] ?? 0) - (a[i] ?? 0);
    }
  }
  return 0;
}

/** Match a concrete path (query string allowed) to its operation in the spec. */
export function matchOperation(
  operations: ApiOperation[],
  method: string,
  concretePath: string,
): ApiOperation | undefined {
  const upperMethod = method.toUpperCase();
  const segments = pathSegments(concretePath);
  const candidates = operations.filter((op) => {
    if (op.method !== upperMethod) {
      return false;
    }
    const template = pathSegments(op.path);
    return (
      template.length === segments.length &&
      template.every((part, i) => segmentPattern(part).test(segments[i] ?? ""))
    );
  });
  return candidates.sort((a, b) =>
    compareSpecificity(
      specificity(pathSegments(a.path)),
      specificity(pathSegments(b.path)),
    ),
  )[0];
}

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

function jsonSchemaOf(value: unknown): unknown {
  const parsed = RequestBodySchema.safeParse(value);
  return parsed.success
    ? parsed.data.content?.["application/json"]?.schema
    : undefined;
}

/**
 * The operation's contract: what a caller needs to build the request and read
 * the result. Error responses keep only their descriptions.
 */
export function getOperationContract(spec: OpenApiSpec, op: ApiOperation) {
  const schemas = spec.components?.schemas ?? {};
  const inline = (node: unknown) =>
    node === undefined ? null : inlineRefs(node, schemas);
  const responses = Object.entries(op.operation.responses ?? {}).flatMap(
    ([status, response]) => {
      const parsed = ResponseObjectSchema.safeParse(response);
      return parsed.success ? [[status, parsed.data] as const] : [];
    },
  );
  const success = responses
    .filter(([status]) => status.startsWith("2"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, response]) => jsonSchemaOf(response))
    .find(Boolean);
  const errors = responses.filter(
    ([status, response]) =>
      !status.startsWith("2") &&
      response.description !== FRAMEWORK_VALIDATION_ERROR,
  );
  return {
    endpoint: op.endpoint,
    method: op.method,
    path: op.path,
    summary: op.summary,
    description: op.description,
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
          ...(description && !inSchema ? { description } : {}),
          ...("example" in parsed.data ? { example: parsed.data.example } : {}),
        },
      ];
    }),
    requestBodySchema: inline(jsonSchemaOf(op.operation.requestBody)),
    responseSchema: inline(success),
    errors: Object.fromEntries(
      errors.map(([status, response]) => [status, response.description ?? ""]),
    ),
  };
}
