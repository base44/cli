import MiniSearch from "minisearch";
import type { ApiOperation } from "./operations.js";

const BOOST = { path: 8, summary: 5, description: 2, parameters: 0.5 };
// Below this share of the best score a hit is noise from one common word.
const MIN_RELATIVE_SCORE = 0.2;
// MiniSearch's default keeps symbols, so `failed` and <Info> would stay glued.
const TOKEN_SEPARATOR = /[\n\r\p{Z}\p{P}\p{S}]+/u;
// Words every description is full of; "who am i" should find nothing, not five guesses.
const STOPWORDS = new Set(
  "a an and are at be by do does for from how i in is it its me my of on or our that the this to we what who with you your".split(
    " ",
  ),
);

function tokenize(text: string): string[] {
  return text
    .split(TOKEN_SEPARATOR)
    .filter((word) => word && !STOPWORDS.has(word.toLowerCase()));
}

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
    tokenize,
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

/** Share of the query's words found in the summary, the operation's own name. */
function summaryCoverage(query: string, op: ApiOperation | undefined): number {
  const terms = tokenize(query.toLowerCase());
  if (!op || terms.length === 0) {
    return 0;
  }
  const words = tokenize(op.summary.toLowerCase());
  return (
    terms.filter((term) => words.some((word) => word.startsWith(term))).length /
    terms.length
  );
}

export function searchOperations(
  operations: ApiOperation[],
  query: string,
  options: { limit?: number; readOnly?: boolean } = {},
): OperationSummary[] {
  const index = buildSearchIndex(operations);
  const hits = index
    .search(query, {
      // Prefixes and typos on short words ("i", "id") match half the spec.
      prefix: (term) => term.length >= 3,
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      boost: BOOST,
      filter: options.readOnly
        ? (hit) => operations[hit.id]?.readOnly === true
        : undefined,
    })
    .map((hit) => ({
      ...hit,
      score: hit.score * (1 + summaryCoverage(query, operations[hit.id])),
    }))
    .sort((a, b) => b.score - a.score);
  const baseline = (hits[0]?.score ?? 0) * MIN_RELATIVE_SCORE;
  return hits
    .filter((hit) => hit.score >= baseline)
    .slice(0, options.limit ?? 5)
    .flatMap((hit) => {
      const op = operations[hit.id];
      return op ? [toOperationSummary(op)] : [];
    });
}
