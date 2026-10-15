import type { ApiOperation } from "./operations.js";
import type { OpenApiSpec } from "./schema.js";
import { type OperationSummary, toOperationSummary } from "./search.js";

const CONTEXT_CHARS = 40;
const MAX_SNIPPETS = 3;
const MAX_SNIPPET_CHARS = 200;

type GrepHit =
  | (OperationSummary & { matches: string[] })
  | { schema: string; matches: string[] };

// Snippets come from JSON text; undo its escapes so the output isn't escaped twice.
function unescapeJson(snippet: string): string {
  return snippet.replace(/\\[nrt]/g, " ").replace(/\\"/g, '"');
}

function snippets(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(0, match.index - CONTEXT_CHARS);
    const end = match.index + match[0].length + CONTEXT_CHARS;
    found.push(
      unescapeJson(text.slice(start, Math.min(end, start + MAX_SNIPPET_CHARS))),
    );
    if (found.length === MAX_SNIPPETS || match[0].length === 0) {
      break;
    }
  }
  return found;
}

/**
 * Regex over the spec's JSON text. The served spec is one minified line, so
 * matches are grouped by the operation or component schema they fall in.
 * Pass `schemas: false` to search only the given operations.
 */
export function grepSpec(
  spec: OpenApiSpec,
  operations: ApiOperation[],
  pattern: string,
  options: { ignoreCase?: boolean; limit?: number; schemas?: boolean } = {},
): GrepHit[] {
  const regex = new RegExp(pattern, options.ignoreCase ? "gi" : "g");
  const hits: GrepHit[] = [];
  for (const op of operations) {
    // operationId and security are generated noise, not what anyone greps for.
    const { summary, description, parameters, requestBody, responses } =
      op.operation;
    const matches = snippets(
      `${op.endpoint} ${JSON.stringify({ summary, description, parameters, requestBody, responses })}`,
      regex,
    );
    if (matches.length > 0) {
      hits.push({ ...toOperationSummary(op), matches });
    }
  }
  const schemas = options.schemas === false ? {} : spec.components?.schemas;
  for (const [schema, definition] of Object.entries(schemas ?? {})) {
    const matches = snippets(JSON.stringify(definition), regex);
    if (matches.length > 0) {
      hits.push({ schema, matches });
    }
  }
  return hits.slice(0, options.limit ?? 20);
}
