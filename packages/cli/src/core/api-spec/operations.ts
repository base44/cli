import {
  HTTP_METHODS,
  type OpenApiOperation,
  type OpenApiSpec,
  ParameterSchema,
} from "./schema.js";
import { cleanText } from "./text.js";

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
        ? [parsed.data.name, cleanText(parsed.data.description ?? "")]
        : [];
    })
    .join(" ");
}

/** Path-level parameters apply to every method; the operation's own win by name and location. */
function mergeParameters(
  shared: unknown[] | undefined,
  own: unknown[] | undefined,
): unknown[] | undefined {
  if (!shared?.length) {
    return own;
  }
  const key = (parameter: unknown) => {
    const parsed = ParameterSchema.safeParse(parameter);
    return parsed.success ? `${parsed.data.in}:${parsed.data.name}` : undefined;
  };
  const ownKeys = new Set((own ?? []).map(key));
  return [
    ...shared.filter((parameter) => !ownKeys.has(key(parameter))),
    ...(own ?? []),
  ];
}

export function listOperations(spec: OpenApiSpec): ApiOperation[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const declared = item[method];
      if (!declared) {
        return [];
      }
      const operation = {
        ...declared,
        parameters: mergeParameters(item.parameters, declared.parameters),
      };
      return [
        {
          endpoint: `${method.toUpperCase()} ${path}`,
          method: method.toUpperCase(),
          path,
          summary: operation.summary ?? "",
          // Without docs links and callout tags, which search would read as words.
          description: cleanText(operation.description ?? ""),
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

/** "1" per literal segment, so `/workflows/runs` ("11") outranks `/workflows/{workflow_id}` ("10"). */
function literalSegments(path: string): string {
  return pathSegments(path)
    .map((segment) => (segment.includes("{") ? "0" : "1"))
    .join("");
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
    literalSegments(b.path).localeCompare(literalSegments(a.path)),
  )[0];
}
