#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/auth/login.js";
import { whoamiCommand } from "./commands/auth/whoami.js";
import { logoutCommand } from "./commands/auth/logout.js";
import { entitiesPushCommand } from "./commands/entities/push.js";
import { functionsDeployCommand } from "./commands/functions/deploy.js";
import { createCommand } from "./commands/project/create.js";
import { dashboardCommand } from "./commands/project/dashboard.js";
import { linkCommand } from "./commands/project/link.js";
import { siteDeployCommand } from "./commands/site/deploy.js";
import packageJson from "../../package.json";

const program = new Command();

program
  .name("base44")
  .description(
    "Base44 CLI - Unified interface for managing Base44 applications"
  )
  .version(packageJson.version);

program.configureHelp({
  sortSubcommands: true
})

// Register authentication commands
program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(logoutCommand);

// Register project commands
program.addCommand(createCommand);
program.addCommand(dashboardCommand);
program.addCommand(linkCommand);

// Register entities commands
program.addCommand(entitiesPushCommand);

// Register functions commands
program.addCommand(functionsDeployCommand);

// Register site commands
program.addCommand(siteDeployCommand);

// Parse command line arguments
program.parse();
