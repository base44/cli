import { log } from "@clack/prompts";
import { BaseCommand } from "../lib/base-command.js";
import { deleteAuth } from "../../core/auth/index.js";

export default class Logout extends BaseCommand {
  static override description = "Logout from current device";
  static override examples = ["<%= config.bin %> logout"];

  async run(): Promise<void> {
    await deleteAuth();
    log.info("Logged out successfully");
  }
}
