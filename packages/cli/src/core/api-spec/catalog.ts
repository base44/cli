import type { ApiOperation } from "./operations.js";
import { type OperationSummary, toOperationSummary } from "./search.js";

const INLINE_AREA_MAX = 2;
const AREA_SAMPLE_MAX = 3;

// Code-point order; localeCompare would sort "{" before letters.
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The area a path belongs to: the segment after `{app_id}`, else the one after `/api`. */
export function areaOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const appIdIndex = parts.indexOf("{app_id}");
  if (appIdIndex !== -1 && appIdIndex + 1 < parts.length) {
    return parts[appIdIndex + 1] ?? "other";
  }
  if (parts[0] === "api" && parts.length > 1) {
    return parts[1] ?? "other";
  }
  return parts[0] ?? "other";
}

/** Operations bucketed by area; areas and their operations both sorted. */
export function groupByArea(
  operations: ApiOperation[],
): Map<string, ApiOperation[]> {
  const sorted = [...operations].sort((a, b) =>
    byCodePoint(`${a.method} ${a.path}`, `${b.method} ${b.path}`),
  );
  const areas = new Map<string, ApiOperation[]>();
  for (const op of sorted) {
    const area = areaOf(op.path);
    areas.set(area, [...(areas.get(area) ?? []), op]);
  }
  return new Map([...areas].sort(([a], [b]) => byCodePoint(a, b)));
}

// A sample of reads says what an area holds; a sorted list starts with DELETEs.
function readsFirst(ops: ApiOperation[]): ApiOperation[] {
  const isRead = (op: ApiOperation) => (op.method === "GET" ? 0 : 1);
  return [...ops].sort((a, b) => isRead(a) - isRead(b));
}

type AreaEntry =
  | { area: string; operations: OperationSummary[] }
  | { area: string; operationCount: number; sample: string[] };

/** Every area; small ones listed in full, the rest as a count and sample summaries. */
export function catalogIndex(operations: ApiOperation[]): {
  areas: AreaEntry[];
  total: number;
} {
  const areas = [...groupByArea(operations)].map(
    ([area, ops]): AreaEntry =>
      ops.length <= INLINE_AREA_MAX
        ? { area, operations: ops.map(toOperationSummary) }
        : {
            area,
            operationCount: ops.length,
            sample: readsFirst(ops)
              .slice(0, AREA_SAMPLE_MAX)
              .map((op) => op.summary),
          },
  );
  return { areas, total: operations.length };
}
