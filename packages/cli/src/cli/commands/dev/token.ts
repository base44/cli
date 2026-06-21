import type { Command } from "commander";
import { createJwtToken } from "@/cli/dev/dev-server/auth/tokens.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readAuth } from "@/core/auth/index.js";
import { readEnv } from "@/core/dev/registry.js";

interface DevTokenOptions {
  email?: string;
  name?: string;
  json?: boolean;
}

/**
 * Mint a local dev JWT for a seeded user. This is how local auth meets the
 * SDK: the dev server trusts any token whose `sub` is a known local user, so
 * an agent can do `createClient({ serverUrl, appId, token })` — or open the
 * app with `?access_token=<token>` so `auth.me()` returns that user with their
 * role — without any browser login. Defaults to the seeded CLI admin.
 */
async function devTokenAction(
  _ctx: CLIContext,
  options: DevTokenOptions,
): Promise<RunCommandResult> {
  let email = options.email;
  if (!email) {
    const auth = await readAuth();
    email = auth.email;
  }

  const token = createJwtToken(email);

  if (options.json) {
    const env = options.name ? await readEnv(options.name) : null;
    return {
      stdout: `${JSON.stringify(
        {
          token,
          email,
          ...(env ? { serverUrl: env.url, appId: env.appId } : {}),
        },
        null,
        2,
      )}\n`,
    };
  }

  return { stdout: `${token}\n` };
}

export function getTokenCommand(): Command {
  return new Base44Command("token", {
    requireAuth: true,
    requireAppContext: false,
  })
    .description("Mint a local dev auth token for use with the SDK")
    .option("--email <email>", "User to mint a token for (default: CLI admin)")
    .option("--name <env>", "Include the env's serverUrl + appId (with --json)")
    .option("--json", "Output machine-readable JSON")
    .action(devTokenAction);
}
