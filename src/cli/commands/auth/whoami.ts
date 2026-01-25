import { Command } from "commander";
import { readAuth } from "@core/auth/index.js";
import { runCommand, theme } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

/**
 * JSON output result for the whoami command.
 */
interface WhoamiResult {
  /** The email address of the authenticated user. */
  email: string;
  /** The display name of the authenticated user. */
  name: string;
}

async function whoami(): Promise<RunCommandResult<WhoamiResult>> {
  const auth = await readAuth();
  return {
    outroMessage: `Logged in as: ${theme.styles.bold(auth.email)}`,
    data: {
      email: auth.email,
      name: auth.name,
    },
  };
}

export const whoamiCommand = new Command("whoami")
  .description("Display current authenticated user")
  .action(async () => {
    await runCommand(whoami, { requireAuth: true, requireAppConfig: false });
  });
