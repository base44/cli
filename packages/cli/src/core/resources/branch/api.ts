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
    status: z.enum(["active", "merged", "deleted"]),
  }),
);

export async function listBranches() {
  let response: KyResponse;
  try {
    response = await getAppClient().get("branches", { timeout: 30_000 });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing branches");
  }
  const result = BranchesSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid branches response from server",
      result.error,
    );
  }
  return result.data.filter((branch) => branch.status === "active");
}

export async function resolveBranchName(
  name: string,
): Promise<string | undefined> {
  if (name === "main") return undefined;
  const branches = await listBranches();
  const matches = branches.filter((branch) => branch.branch_name === name);
  if (matches.length === 0) {
    throw new InvalidInputError(`Branch "${name}" was not found in this app.`);
  }
  if (matches.length > 1) {
    throw new InvalidInputError(
      `Branch name "${name}" is ambiguous. Give the branches unique names before retrying.`,
    );
  }
  return matches[0].id;
}
