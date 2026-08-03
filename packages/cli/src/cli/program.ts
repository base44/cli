import { Command, Option } from "commander";
import { getAgentSkillsCommand } from "@/cli/commands/agent-skills/index.js";
import { getAgentsCommand } from "@/cli/commands/agents/index.js";
import { getAuthCommand } from "@/cli/commands/auth/index.js";
import { getLoginCommand } from "@/cli/commands/auth/login.js";
import { getLogoutCommand } from "@/cli/commands/auth/logout.js";
import { getWhoamiCommand } from "@/cli/commands/auth/whoami.js";
import { getConnectorsCommand } from "@/cli/commands/connectors/index.js";
import { getDashboardCommand } from "@/cli/commands/dashboard/index.js";
import { getEntitiesPushCommand } from "@/cli/commands/entities/push.js";
import { getFunctionsCommand } from "@/cli/commands/functions/index.js";
import { getBuildCommand } from "@/cli/commands/project/build.js";
import { getCreateCommand } from "@/cli/commands/project/create.js";
import { getDeployCommand } from "@/cli/commands/project/deploy.js";
import { getLinkCommand } from "@/cli/commands/project/link.js";
import { getLogsCommand } from "@/cli/commands/project/logs.js";
import { getScaffoldCommand } from "@/cli/commands/project/scaffold.js";
import { getVisibilityCommand } from "@/cli/commands/project/visibility.js";
import { getSandboxCommand } from "@/cli/commands/sandbox/index.js";
import { getSecretsCommand } from "@/cli/commands/secrets/index.js";
import { getSiteCommand } from "@/cli/commands/site/index.js";
import { getTypesCommand } from "@/cli/commands/types/index.js";
import { getWorkspaceCommand } from "@/cli/commands/workspace/index.js";
import { Base44Command } from "@/cli/utils/index.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import packageJson from "../../package.json";
import { getDevCommand } from "./commands/dev.js";
import { getExecCommand } from "./commands/exec.js";
import { getEjectCommand } from "./commands/project/eject.js";
import type { CLIContext } from "./types.js";

export function createProgram(context: CLIContext): Command {
  const program = new Command();

  program
    .name("base44")
    .description(
      "Base44 CLI - Unified interface for managing Base44 applications",
    )
    .version(packageJson.version)
    .addOption(
      new Option("--app-id <id>", "Base44 app ID to use").env(
        BASE44_APP_ID_ENV_VAR,
      ),
    )
    .addOption(
      new Option(
        "--json",
        "Output machine-readable JSON to stdout (status/logs go to stderr)",
      ),
    );

  program.configureHelp({
    sortSubcommands: true,
  });

  // Inject CLIContext into all Base44Command instances before action runs
  program.hook("preAction", (_, actionCommand) => {
    if (actionCommand instanceof Base44Command) {
      actionCommand.setContext(context);
    }
  });

  // Register authentication commands
  program.addCommand(getLoginCommand());
  program.addCommand(getWhoamiCommand());
  program.addCommand(getLogoutCommand());

  // Register project commands
  program.addCommand(getCreateCommand());
  program.addCommand(getScaffoldCommand());
  program.addCommand(getDashboardCommand());
  program.addCommand(getBuildCommand());
  program.addCommand(getDeployCommand());
  program.addCommand(getVisibilityCommand());
  program.addCommand(getLinkCommand());
  program.addCommand(getEjectCommand());

  // Register workspace commands
  program.addCommand(getWorkspaceCommand());

  // Register entities commands
  program.addCommand(getEntitiesPushCommand());

  // Register agents commands
  program.addCommand(getAgentsCommand());

  // Register agent-skills commands
  program.addCommand(getAgentSkillsCommand());

  // Register connectors commands
  program.addCommand(getConnectorsCommand());

  // Register functions commands
  program.addCommand(getFunctionsCommand());

  // Register secrets commands
  program.addCommand(getSecretsCommand());

  // Register sandbox (remote development) commands
  program.addCommand(getSandboxCommand());

  // Register auth config commands
  program.addCommand(getAuthCommand());

  // Register site commands
  program.addCommand(getSiteCommand());

  // Register types command
  program.addCommand(getTypesCommand());

  // Register exec command
  program.addCommand(getExecCommand());

  // Register development commands
  program.addCommand(getDevCommand());

  // Register logs command
  program.addCommand(getLogsCommand());

  return program;
}
