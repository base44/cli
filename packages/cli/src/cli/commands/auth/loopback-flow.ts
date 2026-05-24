import type { Logger } from "@base44-cli/logger";
import open from "open";
import type { RunTaskFn } from "@/cli/utils/runTask.js";
import { theme } from "@/cli/utils/theme.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  type TokenResponse,
} from "@/core/auth/index.js";
import { startLoopbackServer } from "@/core/auth/loopback-server.js";
import { generatePkcePair, generateState } from "@/core/auth/pkce.js";

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Returns true if the current environment can't reach a localhost callback
 * (SSH, no DISPLAY on Linux, common CI signals). In these cases we skip the
 * loopback flow and use device code instead.
 */
export function isHeadlessEnv(): boolean {
  const env = process.env;
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true;
  if (env.CI || env.CONTINUOUS_INTEGRATION) return true;
  if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return true;
  }
  return false;
}

/**
 * Loopback (RFC 8252) authorization-code-with-PKCE login.
 *
 * Caller is responsible for falling back to device code if this throws.
 */
export async function loginViaLoopback(
  log: Logger,
  runTask: RunTaskFn,
): Promise<TokenResponse> {
  const server = await startLoopbackServer();
  const pkce = generatePkcePair();
  const state = generateState();

  try {
    const authorizeUrl = buildAuthorizeUrl({
      redirectUri: server.redirectUri,
      state,
      codeChallenge: pkce.codeChallenge,
    });

    log.info(
      `Opening your browser to sign in.\nIf it doesn't open, visit: ${theme.styles.dim(
        authorizeUrl,
      )}`,
    );

    try {
      await open(authorizeUrl);
    } catch {
      // Browser open failed — the user can still paste the URL manually.
    }

    const { code } = await runTask(
      "Waiting for browser sign-in...",
      async () => server.waitForCallback(state, CALLBACK_TIMEOUT_MS),
      {
        successMessage: "Browser sign-in completed",
        errorMessage: "Browser sign-in failed",
      },
    );

    const token = await runTask(
      "Exchanging authorization code...",
      async () =>
        exchangeCodeForToken({
          code,
          redirectUri: server.redirectUri,
          codeVerifier: pkce.codeVerifier,
        }),
      {
        successMessage: "Authentication completed!",
        errorMessage: "Token exchange failed",
      },
    );

    return token;
  } finally {
    server.close();
  }
}
