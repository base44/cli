import {
  HTTP_METHODS,
  type OpenApiOperation,
  type OpenApiSpec,
  ParameterSchema,
} from "./schema.js";

const PERSONAL_ACCESS_TOKEN_SCHEME = "PersonalAccessTokenAuth";
const READ_ONLY_SCOPE = "read_only";

export interface ApiOperation {
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

function collectRefs(
  value: unknown,
  spec: OpenApiSpec,
  found: Map<string, unknown>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, spec, found);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string" && !found.has(child)) {
      const target = resolvePointer(spec, child);
      found.set(child, target);
      collectRefs(target, spec, found);
    } else {
      collectRefs(child, spec, found);
    }
  }
}

function resolvePointer(spec: OpenApiSpec, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      spec,
    );
}

/** An operation's contract, with every schema it references (`$ref` → definition). */
export function getOperationContract(spec: OpenApiSpec, op: ApiOperation) {
  const { parameters, requestBody, responses } = op.operation;
  const refs = new Map<string, unknown>();
  collectRefs({ parameters, requestBody, responses }, spec, refs);
  return {
    method: op.method,
    path: op.path,
    summary: op.summary,
    description: op.description,
    readOnly: op.readOnly,
    parameters: parameters ?? [],
    requestBody: requestBody ?? null,
    responses: responses ?? {},
    refs: Object.fromEntries(refs),
  };
}
