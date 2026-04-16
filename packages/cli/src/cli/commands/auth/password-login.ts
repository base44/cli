import { dirname, join } from "node:path";
import { Argument, type Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  DEFAULT_AUTH_CONFIG,
  hasAnyLoginMethod,
  readAuthConfig,
  writeAuthConfig,
} from "@/core/resources/auth-config/index.js";

async function passwordLoginAction(
  { log, runTask }: CLIContext,
  action: "enable" | "disable",
): Promise<RunCommandResult> {
  const shouldEnable = action === "enable";
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const authDir = join(configDir, project.authDir);

  const updated = await runTask("Updating local auth config", async () => {
    const current = (await readAuthConfig(authDir)) ?? DEFAULT_AUTH_CONFIG;
    const merged = { ...current, enableUsernamePassword: shouldEnable };
    await writeAuthConfig(authDir, merged);
    return merged;
  });

  if (!shouldEnable && !hasAnyLoginMethod(updated)) {
    log.warn(
      "Disabling password auth will leave no login methods enabled. Users will be locked out.",
    );
  }

  const newStatus = shouldEnable ? "enabled" : "disabled";
  return {
    outroMessage: `Username & password authentication ${newStatus} in local config. Run \`base44 auth push\` or \`base44 deploy\` to apply.`,
  };
}

export function getPasswordLoginCommand(): Command {
  return new Base44Command("password-login")
    .description("Enable or disable username & password authentication")
    .addArgument(
      new Argument(
        "<action>",
        "enable or disable password authentication",
      ).choices(["enable", "disable"]),
    )
    .action(passwordLoginAction);
}
