import { Command } from "commander";
import { getAgentsCommand } from "@/cli/commands/agents/index.js";
import { getLoginCommand } from "@/cli/commands/auth/login.js";
import { getLogoutCommand } from "@/cli/commands/auth/logout.js";
import { getWhoamiCommand } from "@/cli/commands/auth/whoami.js";
import { getConnectorsCommand } from "@/cli/commands/connectors/index.js";
import { getDashboardCommand } from "@/cli/commands/dashboard/index.js";
import { getEntitiesPushCommand } from "@/cli/commands/entities/push.js";
import { getFunctionsDeployCommand } from "@/cli/commands/functions/deploy.js";
import { getCreateCommand } from "@/cli/commands/project/create.js";
import { getDeployCommand } from "@/cli/commands/project/deploy.js";
import { getLinkCommand } from "@/cli/commands/project/link.js";
import { getLogsCommand } from "@/cli/commands/project/logs.js";
import { getSiteCommand } from "@/cli/commands/site/index.js";
import { getTypesCommand } from "@/cli/commands/types/index.js";
import packageJson from "../../package.json";
import { getDevCommand } from "./commands/dev.js";
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

  // Register authentication commands
  program.addCommand(getLoginCommand(context));
  program.addCommand(getWhoamiCommand(context));
  program.addCommand(getLogoutCommand(context));

  // Register project commands
  program.addCommand(getCreateCommand(context));
  program.addCommand(getDashboardCommand(context));
  program.addCommand(getDeployCommand(context));
  program.addCommand(getLinkCommand(context));
  program.addCommand(getEjectCommand(context));

  // Register entities commands
  program.addCommand(getEntitiesPushCommand(context));

  // Register agents commands
  program.addCommand(getAgentsCommand(context));

  // Register connectors commands
  program.addCommand(getConnectorsCommand(context));

  // Register functions commands
  program.addCommand(getFunctionsDeployCommand(context));

  // Register site commands
  program.addCommand(getSiteCommand(context));

  // Register types command
  program.addCommand(getTypesCommand(context));

  // Register development commands
  program.addCommand(getDevCommand(context), { hidden: true });

  // Register logs command
  program.addCommand(getLogsCommand(context));

  return program;
}
