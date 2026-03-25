import { Command } from "commander";
import { getAgentsCommand } from "@/cli/commands/agents/index.js";
import { getAuthCommand } from "@/cli/commands/auth/index.js";
import { getLoginCommand } from "@/cli/commands/auth/login.js";
import { getLogoutCommand } from "@/cli/commands/auth/logout.js";
import { getWhoamiCommand } from "@/cli/commands/auth/whoami.js";
import { getConnectorsCommand } from "@/cli/commands/connectors/index.js";
import { getDashboardCommand } from "@/cli/commands/dashboard/index.js";
import { getEntitiesPushCommand } from "@/cli/commands/entities/push.js";
import { getFunctionsCommand } from "@/cli/commands/functions/index.js";
import { getCreateCommand } from "@/cli/commands/project/create.js";
import { getDeployCommand } from "@/cli/commands/project/deploy.js";
import { getLinkCommand } from "@/cli/commands/project/link.js";
import { getLogsCommand } from "@/cli/commands/project/logs.js";
import { getSecretsCommand } from "@/cli/commands/secrets/index.js";
import { getSiteCommand } from "@/cli/commands/site/index.js";
import { getTypesCommand } from "@/cli/commands/types/index.js";
import { Base44Command } from "@/cli/utils/index.js";
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
    .version(packageJson.version);

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
  program.addCommand(getDashboardCommand());
  program.addCommand(getDeployCommand());
  program.addCommand(getLinkCommand());
  program.addCommand(getEjectCommand());

  // Register entities commands
  program.addCommand(getEntitiesPushCommand());

  // Register agents commands
  program.addCommand(getAgentsCommand());

  // Register connectors commands
  program.addCommand(getConnectorsCommand());

  // Register functions commands
  program.addCommand(getFunctionsCommand());

  // Register secrets commands
  program.addCommand(getSecretsCommand());

  // Register auth config commands
  program.addCommand(getAuthCommand(), { hidden: true });

  // Register site commands
  program.addCommand(getSiteCommand());

  // Register types command
  program.addCommand(getTypesCommand());

  // Register exec command
  program.addCommand(getExecCommand());

  // Register development commands
  program.addCommand(getDevCommand(), { hidden: true });

  // Register logs command
  program.addCommand(getLogsCommand());

  return program;
}
