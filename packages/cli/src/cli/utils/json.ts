/**
 * Serialize a value as JSON for stdout (the `--json` contract): pretty by
 * default, compact with `compact` (e.g. when piped).
 */
export function toJsonStdout(
  result: unknown,
  options: { compact?: boolean } = {},
): string {
  return `${JSON.stringify(result, null, options.compact ? undefined : 2)}\n`;
}
