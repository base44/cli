import type { KyResponse } from "ky";
import { z } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import {
  ApiError,
  InvalidInputError,
  SchemaValidationError,
} from "@/core/errors.js";

const BranchesSchema = z.array(
  z.object({
    id: z.string().min(1),
    branch_name: z.string(),
  }),
);

export async function resolveBranchName(
  name: string,
): Promise<string | undefined> {
  if (name === "main") return undefined;

  let response: KyResponse;
  try {
    response = await getAppClient().get("branches", { timeout: 30_000 });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "resolving branch name");
  }
  const result = BranchesSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid branches response from server",
      result.error,
    );
  }
  const matches = result.data.filter((branch) => branch.branch_name === name);
  if (matches.length === 0) {
    throw new InvalidInputError(`Branch "${name}" was not found in this app.`);
  }
  if (matches.length > 1) {
    throw new InvalidInputError(
      `Branch name "${name}" is ambiguous. Use --branch-id.`,
    );
  }
  return matches[0].id;
}
