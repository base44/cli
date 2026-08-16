import type { Command } from "commander";
import { Option } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, normalizeDatetime } from "@/cli/utils/index.js";
import type {
  WorkflowRun,
  WorkflowRunStatus,
} from "@/core/resources/workflow/index.js";
import {
  listWorkflowRuns,
  listWorkflows,
  WorkflowRunStatusSchema,
} from "@/core/resources/workflow/index.js";
import { rethrowLegacyAppAsExplanation } from "./legacy-app.js";
import { MAX_LIMIT, parseLimit } from "./limit.js";

interface RunsOptions {
  status?: WorkflowRunStatus;
  since?: string;
  limit?: string;
}

function formatDuration(durationMs: number): string {
  if (durationMs === 0) return "";
  return `  ${(durationMs / 1000).toFixed(1)}s`;
}

function formatRunTags(run: WorkflowRun): string {
  const tags = [run.triggerType, run.isTestRun ? "test" : null].filter(Boolean);
  return tags.length > 0 ? `  (${tags.join(", ")})` : "";
}

function formatFailureDetail(run: WorkflowRun): string {
  const reason = run.statusReason ? ` [${run.statusReason}]` : "";
  const message = run.errorMessage ? `\n    ${run.errorMessage}` : "";
  return `${reason}${message}`;
}

function formatRunLine(run: WorkflowRun): string {
  const time = (run.startedAt ?? "").substring(0, 19).replace("T", " ");
  const status = run.status.toUpperCase().padEnd(9);
  const base = `${time} ${status} ${run.workflowName}${formatRunTags(run)}${formatDuration(run.durationMs)}`;
  const failureDetail =
    run.status === "failed" || run.status === "cancelled"
      ? formatFailureDetail(run)
      : "";
  return `${base}${failureDetail}`;
}

async function describeEmptyResult(hasFilters: boolean): Promise<string> {
  const workflows = await listWorkflows().catch(() => null);
  if (workflows === null) {
    return "No runs found.";
  }
  if (workflows.length === 0) {
    return "This app has no workflows, so there are no runs.";
  }
  const names = workflows.map((workflow) => workflow.name).join(", ");
  return hasFilters
    ? `No runs match your filters. Workflows in this app: ${names}.`
    : `No runs yet. Workflows in this app: ${names}.`;
}

async function runsAction(
  ctx: CLIContext,
  options: RunsOptions,
): Promise<RunCommandResult> {
  const limit = parseLimit(options.limit);

  const runs = await ctx.runTask(
    "Fetching workflow runs from Base44",
    async () =>
      listWorkflowRuns({
        status: options.status,
        since: options.since,
        limit,
      }).catch(rethrowLegacyAppAsExplanation),
    {
      successMessage: "Workflow runs fetched successfully",
      errorMessage: "Failed to fetch workflow runs",
    },
  );

  if (ctx.jsonMode) {
    return {
      outroMessage: `Found ${runs.length} runs.`,
      stdout: `${JSON.stringify({ runs }, null, 2)}\n`,
    };
  }

  if (runs.length === 0) {
    const hasFilters = Boolean(options.status || options.since);
    return { outroMessage: await describeEmptyResult(hasFilters) };
  }

  for (const run of runs) {
    ctx.log.info(formatRunLine(run));
  }

  return { outroMessage: `Found ${runs.length} runs.` };
}

export function getWorkflowsRunsCommand(): Command {
  return new Base44Command("runs")
    .description(
      "List workflow runs for this app, newest first (includes scheduled, manual, and test runs)",
    )
    .addOption(
      new Option("--status <status>", "Filter by run status").choices([
        ...WorkflowRunStatusSchema.options,
      ]),
    )
    .option(
      "--since <datetime>",
      "Show runs started after this time. ISO datetime or relative shorthand (e.g. 1h, 30m, 2d)",
      normalizeDatetime,
    )
    .option(
      "-n, --limit <n>",
      `Number of runs to return (1-${MAX_LIMIT}, default: 30)`,
    )
    .action(runsAction);
}
