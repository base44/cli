/** Serialize a value as pretty JSON for stdout (the `--json` contract). */
export function toJsonStdout(result: unknown): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
