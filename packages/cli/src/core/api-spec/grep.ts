import { getOperationContract } from "./contract.js";
import type { ApiOperation } from "./operations.js";
import type { OpenApiSpec } from "./schema.js";
import { type OperationSummary, toOperationSummary } from "./search.js";

/**
 * Operations whose contract matches a regular expression. The contract has
 * its schemas inlined, so a field such as `webhook_secret` finds the
 * operation that sends or returns it, not just the schema that declares it.
 */
export function grepOperations(
  spec: OpenApiSpec,
  operations: ApiOperation[],
  pattern: string,
  options: { ignoreCase?: boolean; limit?: number } = {},
): OperationSummary[] {
  const regex = new RegExp(pattern, options.ignoreCase ? "i" : "");
  return operations
    .filter((op) => regex.test(JSON.stringify(getOperationContract(spec, op))))
    .slice(0, options.limit ?? 20)
    .map(toOperationSummary);
}
