import MiniSearch from "minisearch";
import type { ApiOperation } from "./operations.js";

const BOOST = {
  method: 1,
  path: 8,
  summary: 5,
  description: 2,
  parameters: 0.5,
};
// Below this share of the best score a hit is noise from one common word.
const MIN_RELATIVE_SCORE = 0.2;
// MiniSearch's default keeps symbols, so `failed` and <Info> would stay glued.
const TOKEN_SEPARATOR = /[\n\r\p{Z}\p{P}\p{S}]+/u;
// Words every description is full of; "who am i" should find nothing, not five guesses.
const STOPWORDS = new Set(
  "a an and are at be by do does for from how i id in is it its me my of on or our that the this to we what who with you your".split(
    " ",
  ),
);

/** Words of two letters or more, without stopwords; a lone "x" matches junk. */
function tokenize(text: string): string[] {
  return text
    .split(TOKEN_SEPARATOR)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word.toLowerCase()));
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
    // The method lets "DELETE workflow" find "Archive workflow".
    fields: ["method", "path", "summary", "description", "parameters"],
    tokenize,
  });
  index.addAll(
    operations.map((op, id) => ({
      id,
      method: op.method,
      // Placeholders like {workflow_id} would count "workflow" twice; names are under parameters.
      path: op.path.replace(/\{[^}]*\}/g, ""),
      summary: op.summary,
      description: op.description,
      parameters: op.parameterText,
    })),
  );
  return index;
}

/**
 * How the query matches the summary, the operation's own name: `coverage` is
 * the share of query words found in it, `precision` the share of its words
 * the query names. "get app" covers "Get app" fully and precisely, and
 * "Get app user" fully but less precisely.
 */
function summaryMatch(
  terms: string[],
  op: ApiOperation | undefined,
): { coverage: number; precision: number } {
  const words = tokenize(op?.summary.toLowerCase() ?? "");
  const named = (word: string) => terms.some((term) => word.startsWith(term));
  return {
    coverage:
      terms.filter((term) => words.some((word) => word.startsWith(term)))
        .length / terms.length,
    precision: words.length ? words.filter(named).length / words.length : 0,
  };
}

const readsFirst = (op: ApiOperation | undefined) =>
  op?.method === "GET" ? 0 : 1;

/**
 * Hits whose summary holds every query word rank first, by precision, then
 * reads before writes; the rest follow by score, raised by summary coverage.
 */
export function searchOperations(
  operations: ApiOperation[],
  query: string,
  options: { limit?: number; readOnly?: boolean } = {},
): OperationSummary[] {
  const terms = tokenize(query.toLowerCase());
  if (terms.length === 0) {
    return [];
  }
  const index = buildSearchIndex(operations);
  const hits = index
    .search(query, {
      // Prefixes and typos on short words ("api", "id") match half the spec.
      prefix: (term) => term.length >= 3,
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      boost: BOOST,
      filter: options.readOnly
        ? (hit) => operations[hit.id]?.readOnly === true
        : undefined,
    })
    .map((hit) => {
      const match = summaryMatch(terms, operations[hit.id]);
      return {
        ...hit,
        ...match,
        full: match.coverage === 1,
        score: hit.score * (1 + match.coverage),
      };
    })
    .sort(
      (a, b) =>
        Number(b.full) - Number(a.full) ||
        (a.full
          ? b.precision - a.precision ||
            readsFirst(operations[a.id]) - readsFirst(operations[b.id])
          : 0) ||
        b.score - a.score,
    );
  const baseline =
    Math.max(0, ...hits.map((hit) => hit.score)) * MIN_RELATIVE_SCORE;
  return hits
    .filter((hit) => hit.full || hit.score >= baseline)
    .slice(0, options.limit ?? 5)
    .flatMap((hit) => {
      const op = operations[hit.id];
      return op ? [toOperationSummary(op)] : [];
    });
}
