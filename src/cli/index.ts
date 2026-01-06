#!/usr/bin/env node

import { Command } from "commander";
import { getPackageVersion } from "./utils/index.js";
import { loginCommand } from "./commands/auth/login.js";
import { whoamiCommand } from "./commands/auth/whoami.js";
import { logoutCommand } from "./commands/auth/logout.js";
import { showProjectCommand } from "./commands/project/show-project.js";

const program = new Command();

program
  .name("base44")
  .description(
    "Base44 CLI - Unified interface for managing Base44 applications"
  )
  .version(getPackageVersion());

// Register authentication commands
program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(logoutCommand);

// Register project commands
program.addCommand(showProjectCommand);

// Parse command line arguments
program.parse();
