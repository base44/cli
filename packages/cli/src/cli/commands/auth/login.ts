import type { Command } from "commander";
import { Base44Command } from "@/cli/utils/index.js";
import { login } from "./login-flow.js";

export function getLoginCommand(): Command {
  return (
    new Base44Command("login", {
      requireAuth: false,
      requireAppContext: false,
    })
      .description("Authenticate with Base44")
      // Applied in bootstrap-env.ts; declared here for --help and validation.
      .option(
        "--hostname <host>",
        "Base44 host to log in to and use from then on (default: app.base44.com)",
      )
      .action(login)
  );
}
