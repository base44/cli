import { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { listBranches } from "@/core/resources/branch/api.js";

async function listBranchesAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
  const remote = await runTask("Fetching branches", () => listBranches());
  const branches = [
    { name: "main", status: "active" },
    ...remote.map((branch) => ({
      name: branch.branch_name,
      status: branch.status,
    })),
  ];
  if (jsonMode) return { stdout: `${JSON.stringify({ branches })}\n` };
  for (const branch of branches)
    log.message(`${branch.name} (${branch.status})`);
  return { outroMessage: `${branches.length} branches` };
}

export function getBranchesCommand(): Command {
  return new Command("branches")
    .description("Discover an app's branches")
    .addCommand(
      new Base44Command("list")
        .description("List main and active branch names for use with --branch")
        .action(listBranchesAction),
    );
}
