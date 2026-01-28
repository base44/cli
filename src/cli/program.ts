import { Command } from "commander";
import { loginCommand } from "@/cli/commands/auth/login.js";
import { whoamiCommand } from "@/cli/commands/auth/whoami.js";
import { logoutCommand } from "@/cli/commands/auth/logout.js";
import { entitiesPushCommand } from "@/cli/commands/entities/push.js";
import { agentsCommand } from "@/cli/commands/agents/index.js";
import { functionsDeployCommand } from "@/cli/commands/functions/deploy.js";
import { createCommand } from "@/cli/commands/project/create.js";
import { dashboardCommand } from "@/cli/commands/project/dashboard.js";
import { deployCommand } from "@/cli/commands/project/deploy.js";
import { linkCommand } from "@/cli/commands/project/link.js";
import { siteDeployCommand } from "@/cli/commands/site/deploy.js";
import packageJson from "../../package.json";

const program = new Command();

program
  .name("base44")
  .description(
    "Base44 CLI - Unified interface for managing Base44 applications"
  )
  .version(packageJson.version);

program.configureHelp({
  sortSubcommands: true,
});

// Register authentication commands
program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(logoutCommand);

// Register project commands
program.addCommand(createCommand);
program.addCommand(dashboardCommand);
program.addCommand(deployCommand);
program.addCommand(linkCommand);

// Register entities commands
program.addCommand(entitiesPushCommand);

// Register agents commands
program.addCommand(agentsCommand);

// Register functions commands
program.addCommand(functionsDeployCommand);

// Register site commands
program.addCommand(siteDeployCommand);

export { program };
