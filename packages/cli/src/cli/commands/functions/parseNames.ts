/**
 * Parse names from variadic CLI args, supporting comma-separated values.
 * e.g. ["fn-a", "fn-b,fn-c"] → ["fn-a", "fn-b", "fn-c"]
 */
export function parseNames(args: string[]): string[] {
  return args
    .flatMap((arg) => arg.split(","))
    .map((n) => n.trim())
    .filter(Boolean);
}
