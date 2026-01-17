import { log } from "@clack/prompts";
import { BaseCommand } from "../lib/base-command.js";
import { readAuth } from "../../core/auth/index.js";

export default class Whoami extends BaseCommand {
  static override description = "Display current authenticated user";
  static override examples = ["<%= config.bin %> whoami"];

  async run(): Promise<void> {
    const auth = await readAuth();
    log.info(`Logged in as: ${auth.name} (${auth.email})`);
  }
}
