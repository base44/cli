import { Command } from "commander";
import { loginCommand } from "./commands/auth/login.js";
import { whoamiCommand } from "./commands/auth/whoami.js";
import { logoutCommand } from "./commands/auth/logout.js";
import { entitiesPushCommand } from "./commands/entities/push.js";
import { functionsDeployCommand } from "./commands/functions/deploy.js";
import { createCommand } from "./commands/project/create.js";
import { dashboardCommand } from "./commands/project/dashboard.js";
import { deployCommand } from "./commands/project/deploy.js";
import { linkCommand } from "./commands/project/link.js";
import { siteDeployCommand } from "./commands/site/deploy.js";
import { setJsonMode, isJsonMode } from "./utils/json.js";
import packageJson from "../../package.json";

// Detect --json flag early from process.argv before Commander parses
// This is needed because configureOutput runs before preAction hooks
const isJsonFromArgv = process.argv.includes("--json");
if (isJsonFromArgv) {
  setJsonMode(true);
}

const program = new Command();

// Configure Commander to throw instead of calling process.exit()
// This allows us to catch errors and output JSON when appropriate
program.exitOverride();

// Configure output to suppress default error messages in JSON mode
// We handle error output ourselves in the entry points
program.configureOutput({
  outputError: (str, write) => {
    if (isJsonMode()) {
      // Don't write default error - entry points will handle it
      return;
    }
    write(str);
  },
});

program
  .name("base44")
  .description(
    "Base44 CLI - Unified interface for managing Base44 applications"
  )
  .version(packageJson.version)
  .option("--json", "Output results as JSON (for scripting)");

// Set JSON mode before any command runs (backup for preAction validation)
program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.optsWithGlobals();
  if (opts.json) {
    setJsonMode(true);
  }
});

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

// Register functions commands
program.addCommand(functionsDeployCommand);

// Register site commands
program.addCommand(siteDeployCommand);

export { program };
