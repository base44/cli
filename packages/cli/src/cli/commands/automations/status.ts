import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask, theme } from "@/cli/utils/index.js";
import { listDeployedFunctions } from "@/core/resources/function/api.js";

function formatAutomationType(automation: {
  type: string;
  schedule_mode?: string;
  schedule_type?: string;
}): string {
  if (automation.type === "entity") return "entity";
  if (automation.type === "scheduled") {
    if (automation.schedule_mode === "one-time") return "scheduled (one-time)";
    if (automation.schedule_type === "cron") return "scheduled (cron)";
    return "scheduled (simple)";
  }
  return automation.type;
}

async function statusAction({ log }: CLIContext): Promise<RunCommandResult> {
  const { functions } = await runTask(
    "Fetching automations...",
    async () => listDeployedFunctions(),
    { errorMessage: "Failed to fetch automations" },
  );

  let totalAutomations = 0;
  let functionsWithAutomations = 0;

  for (const fn of functions) {
    if (fn.automations.length === 0) continue;
    functionsWithAutomations++;

    for (const automation of fn.automations) {
      totalAutomations++;
      const active = automation.is_active;
      const statusLabel = active
        ? theme.styles.bold("active")
        : theme.styles.dim("disabled");
      const typeLabel = formatAutomationType(automation);

      log.message(
        `  ${fn.name} / ${automation.name}  ${theme.styles.dim(typeLabel)}  ${statusLabel}`,
      );
    }
  }

  if (totalAutomations === 0) {
    return { outroMessage: "No automations found" };
  }

  return {
    outroMessage: `${totalAutomations} automation${totalAutomations !== 1 ? "s" : ""} across ${functionsWithAutomations} function${functionsWithAutomations !== 1 ? "s" : ""}`,
  };
}

export function getAutomationsStatusCommand(): Command {
  return new Base44Command("status")
    .description("Show status of all automations")
    .action(statusAction);
}
