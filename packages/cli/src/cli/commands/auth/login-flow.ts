import type { Logger } from "@base44-cli/logger";
import pWaitFor from "p-wait-for";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import type { RunTaskFn } from "@/cli/utils/runTask.js";
import { theme } from "@/cli/utils/theme.js";
import type {
  DeviceCodeResponse,
  TokenResponse,
  UserInfoResponse,
} from "@/core/auth/index.js";
import {
  generateDeviceCode,
  getTokenFromDeviceCode,
  getUserInfo,
  writeAuth,
} from "@/core/auth/index.js";
import { AuthExpiredError, InternalError } from "@/core/errors.js";
import { isHeadlessEnv, loginViaLoopback } from "./loopback-flow.js";

async function generateAndDisplayDeviceCode(
  log: Logger,
  runTask: RunTaskFn,
): Promise<DeviceCodeResponse> {
  const deviceCodeResponse = await runTask(
    "Generating device code...",
    async () => {
      return await generateDeviceCode();
    },
    {
      successMessage: "Device code generated",
      errorMessage: "Failed to generate device code",
    },
  );

  log.info(
    `Verification code: ${theme.styles.bold(deviceCodeResponse.userCode)}` +
      `\nPlease confirm this code at: ${deviceCodeResponse.verificationUri}`,
  );

  return deviceCodeResponse;
}

async function waitForAuthentication(
  deviceCode: string,
  expiresIn: number,
  interval: number,
  runTask: RunTaskFn,
): Promise<TokenResponse> {
  let tokenResponse: TokenResponse | undefined;

  try {
    await runTask(
      "Waiting for authentication...",
      async () => {
        await pWaitFor(
          async () => {
            const result = await getTokenFromDeviceCode(deviceCode);
            if (result !== null) {
              tokenResponse = result;
              return true;
            }
            return false;
          },
          {
            interval: interval * 1000,
            timeout: expiresIn * 1000,
          },
        );
      },
      {
        successMessage: "Authentication completed!",
        errorMessage: "Authentication failed",
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      throw new AuthExpiredError("Authentication timed out. Please try again.");
    }
    throw error;
  }

  if (tokenResponse === undefined) {
    throw new InternalError("Failed to retrieve authentication token.");
  }

  return tokenResponse;
}

async function loginViaDeviceCode(
  log: Logger,
  runTask: RunTaskFn,
): Promise<TokenResponse> {
  const deviceCodeResponse = await generateAndDisplayDeviceCode(log, runTask);
  return waitForAuthentication(
    deviceCodeResponse.deviceCode,
    deviceCodeResponse.expiresIn,
    deviceCodeResponse.interval,
    runTask,
  );
}

async function saveAuthData(
  response: TokenResponse,
  userInfo: UserInfoResponse,
): Promise<void> {
  const expiresAt = Date.now() + response.expiresIn * 1000;

  await writeAuth({
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt,
    email: userInfo.email,
    name: userInfo.name,
  });
}

interface LoginOptions {
  /** Force device-code flow, skipping the loopback browser flow. */
  deviceCode?: boolean;
}

/**
 * Execute the login flow.
 *
 * Default path: loopback (RFC 8252) with PKCE — opens browser, awaits localhost
 * callback. Falls back to device code on headless environments (SSH, CI, no
 * DISPLAY) or if the loopback flow fails for any reason.
 */
export async function login(
  { log, runTask }: CLIContext,
  options: LoginOptions = {},
): Promise<RunCommandResult> {
  let token: TokenResponse | undefined;

  const useDeviceCode = options.deviceCode || isHeadlessEnv();

  if (!useDeviceCode) {
    try {
      token = await loginViaLoopback(log, runTask);
    } catch (error) {
      log.warn(
        `Browser sign-in unavailable (${
          error instanceof Error ? error.message : String(error)
        }). Falling back to device code.`,
      );
    }
  }

  if (!token) {
    token = await loginViaDeviceCode(log, runTask);
  }

  const userInfo = await getUserInfo(token.accessToken);

  await saveAuthData(token, userInfo);

  return {
    outroMessage: `Successfully logged in as ${theme.styles.bold(userInfo.email)}`,
  };
}
