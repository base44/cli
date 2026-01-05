import { Command } from "commander";
import { tasks } from "@clack/prompts";
import { writeAuth } from "../../../core/config/auth.js";
import { runCommand } from "../../utils/index.js";

async function login(): Promise<void> {
  await tasks([
    {
      title: "Logging you in",
      task: async () => {
        await writeAuth({
          token: "stub-token-12345",
          email: "valid@email.com",
          name: "KfirStri",
        });

        return "Logged in as KfirStri";
      },
    },
  ]);
}

export const loginCommand = new Command("login")
  .description("Authenticate with Base44")
  .action(async () => {
    await runCommand(login);
  });

