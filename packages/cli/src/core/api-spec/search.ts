import MiniSearch from "minisearch";
import type { ApiOperation } from "./operations.js";

const BOOST = { path: 8, summary: 5, description: 2, parameters: 0.5 };
// Below this share of the best score a hit is noise from one common word.
const MIN_RELATIVE_SCORE = 0.2;
// MiniSearch's default keeps symbols, so `failed` and <Info> would stay glued.
const TOKEN_SEPARATOR = /[\n\r\p{Z}\p{P}\p{S}]+/u;

export interface OperationSummary {
  endpoint: string;
  summary: string;
}

export function toOperationSummary(op: ApiOperation): OperationSummary {
  return { endpoint: op.endpoint, summary: op.summary };
}

function buildSearchIndex(operations: ApiOperation[]): MiniSearch {
  const index = new MiniSearch({
    fields: ["path", "summary", "description", "parameters"],
    tokenize: (text) => text.split(TOKEN_SEPARATOR).filter(Boolean),
  });
  index.addAll(
    operations.map((op, id) => ({
      id,
      // Placeholders like {workflow_id} would count "workflow" twice; names are under parameters.
      path: op.path.replace(/\{[^}]*\}/g, ""),
      summary: op.summary,
      description: op.description,
      parameters: op.parameterText,
    })),
  );
  return index;
}

export function searchOperations(
  operations: ApiOperation[],
  query: string,
  options: { limit?: number; readOnly?: boolean } = {},
): OperationSummary[] {
  const index = buildSearchIndex(operations);
  const hits = index.search(query, {
    prefix: true,
    fuzzy: 0.2,
    boost: BOOST,
    filter: options.readOnly
      ? (hit) => operations[hit.id]?.readOnly === true
      : undefined,
  });
  const baseline = (hits[0]?.score ?? 0) * MIN_RELATIVE_SCORE;
  return hits
    .filter((hit) => hit.score >= baseline)
    .slice(0, options.limit ?? 5)
    .flatMap((hit) => {
      const op = operations[hit.id];
      return op ? [toOperationSummary(op)] : [];
    });
}
