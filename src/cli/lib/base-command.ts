import { Command } from "@oclif/core";
import { log } from "@clack/prompts";

export interface BaseCommandStatics {
  requiresAuth: boolean;
  showFullBanner: boolean;
}

export type BaseCommandClass = Command.Class & BaseCommandStatics;

export abstract class BaseCommand extends Command {
  static requiresAuth = true;
  static showFullBanner = false;

  async catch(err: Error & { exitCode?: number }): Promise<void> {
    log.error(err.stack ?? err.message);
    this.exit(err.exitCode ?? 1);
  }
}
