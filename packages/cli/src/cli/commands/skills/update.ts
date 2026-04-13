import type { Command } from "commander";
import { execa } from "execa";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { findProjectRoot } from "@/core/project/config.js";

const SKILLS_REPO = "base44/skills";

export async function installAllSkills(cwd: string): Promise<void> {
  await execa("npx", ["-y", "skills", "add", SKILLS_REPO, "--all", "-y"], {
    cwd,
  });
}

async function updateAction({
  runTask,
}: CLIContext): Promise<RunCommandResult> {
  const projectRoot = await findProjectRoot();
  if (!projectRoot) {
    return {
      outroMessage:
        "Not in a Base44 project. Run this command from a project directory.",
    };
  }

  await runTask(
    "Updating agent skills...",
    async () => {
      await installAllSkills(projectRoot.root);
    },
    {
      successMessage: theme.colors.base44Orange(
        "Agent skills updated successfully",
      ),
      errorMessage: "Failed to update agent skills",
    },
  );

  return { outroMessage: "Agent skills are up to date" };
}

export function getSkillsUpdateCommand(): Command {
  return new Base44Command("update", {
    requireAuth: false,
    requireAppConfig: false,
  })
    .description("Update locally installed agent skills to the latest version")
    .action(updateAction);
}
