import type { Hook } from "@oclif/core";
import { intro, log } from "@clack/prompts";
import chalk from "chalk";
import { loadProjectEnv } from "../../core/config.js";
import { requireAuth } from "../../core/auth/index.js";
import { printBanner } from "../lib/banner.js";
import type { BaseCommandClass } from "../lib/base-command.js";

const base44Color = chalk.bgHex("#E86B3C");

const hook: Hook.Prerun = async function (options) {
  const command = options.Command as BaseCommandClass;

  const showFullBanner = command.showFullBanner;
  const commandRequiresAuth = command.requiresAuth;

  // Display banner
  if (showFullBanner) {
    printBanner();
  } else {
    intro(base44Color(" Base 44 "));
  }

  // Load project environment
  await loadProjectEnv();

  // Check authentication if required
  if (commandRequiresAuth) {
    try {
      await requireAuth();
    } catch (error) {
      if (error instanceof Error) {
        log.error(error.message);
      }
      options.context.exit(1);
    }
  }
};

export default hook;
