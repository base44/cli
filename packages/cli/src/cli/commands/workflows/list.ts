import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import type { WorkflowListItem } from "@/core/resources/workflow/index.js";
import { listWorkflows } from "@/core/resources/workflow/index.js";
import { rethrowLegacyAppAsExplanation } from "./legacy-app.js";
import { MAX_LIMIT, parseLimit } from "./limit.js";

interface ListOptions {
  limit?: string;
}

function formatWorkflowLine(workflow: WorkflowListItem): string {
  const lastRun = workflow.lastRunAt
    ? `last run ${workflow.lastRunStatus ?? "unknown"} at ${workflow.lastRunAt}`
    : "never ran";
  const failures =
    workflow.consecutiveFailures > 0
      ? ` (${workflow.consecutiveFailures} consecutive failures)`
      : "";
  return `${workflow.name}  [${workflow.status}]  runs: ${workflow.totalRuns}, ${lastRun}${failures}`;
}

async function listAction(
  { log, runTask, jsonMode }: CLIContext,
  options: ListOptions,
): Promise<RunCommandResult> {
  const limit = parseLimit(options.limit);
  const workflows = await runTask(
    "Fetching workflows from Base44",
    async () => listWorkflows(limit).catch(rethrowLegacyAppAsExplanation),
    {
      successMessage: "Workflows fetched successfully",
      errorMessage: "Failed to fetch workflows",
    },
  );

  if (jsonMode) {
    return {
      outroMessage: `Found ${workflows.length} workflows.`,
      stdout: `${JSON.stringify({ workflows }, null, 2)}\n`,
    };
  }

  if (workflows.length === 0) {
    return { outroMessage: "This app has no workflows." };
  }

  for (const workflow of workflows) {
    log.info(formatWorkflowLine(workflow));
  }

  return { outroMessage: `Found ${workflows.length} workflows.` };
}

export function getWorkflowsListCommand(): Command {
  return new Base44Command("list")
    .description("List this app's workflows")
    .option(
      "-n, --limit <n>",
      `Number of workflows to return (1-${MAX_LIMIT}, default: 30)`,
    )
    .action(listAction);
}
