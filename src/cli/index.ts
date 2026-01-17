/**
 * CLI entry point for explicit command discovery.
 *
 * This file exports all commands and hooks for oclif's "explicit" strategy,
 * allowing the CLI to be bundled with tsdown while still working with oclif.
 */

// Commands - exported for oclif explicit strategy
import Login from "./commands/login.js";
import Logout from "./commands/logout.js";
import Whoami from "./commands/whoami.js";
import Create from "./commands/create.js";
import EntitiesPush from "./commands/entities/push.js";
import SiteDeploy from "./commands/site/deploy.js";

// Hooks
import prerunHook from "./hooks/prerun.js";

/**
 * Command mapping for oclif explicit discovery.
 * Keys are command IDs, values are command classes.
 */
export const COMMANDS = {
  login: Login,
  logout: Logout,
  whoami: Whoami,
  create: Create,
  "entities:push": EntitiesPush,
  "site:deploy": SiteDeploy,
};

/**
 * Hooks for oclif.
 */
export const PRERUN_HOOK = prerunHook;
