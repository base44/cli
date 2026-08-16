import { InvalidInputError } from "@/core/errors.js";

export const MAX_LIMIT = 200;

export function parseLimit(limit: string | undefined): number | undefined {
  if (limit === undefined) return undefined;
  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new InvalidInputError(
      `Invalid limit: "${limit}". Must be a number between 1 and ${MAX_LIMIT}.`,
    );
  }
  return parsed;
}
