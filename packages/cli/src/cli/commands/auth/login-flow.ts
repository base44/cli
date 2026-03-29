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

/**
 * Execute the login flow (device code authentication).
 * This function is separate from the command to avoid circular dependencies.
 */
export async function login({
  log,
  runTask,
}: CLIContext): Promise<RunCommandResult> {
  const deviceCodeResponse = await generateAndDisplayDeviceCode(log, runTask);

  const token = await waitForAuthentication(
    deviceCodeResponse.deviceCode,
    deviceCodeResponse.expiresIn,
    deviceCodeResponse.interval,
    runTask,
  );

  const userInfo = await getUserInfo(token.accessToken);

  await saveAuthData(token, userInfo);

  return {
    outroMessage: `Successfully logged in as ${theme.styles.bold(userInfo.email)}`,
  };
}
