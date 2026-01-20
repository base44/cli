import { Command } from "commander";
import { log } from "@clack/prompts";
import pWaitFor from "p-wait-for";
import {
  writeAuth,
  generateDeviceCode,
  getTokenFromDeviceCode,
  getUserInfo,
} from "@core/auth/index.js";
import type {
  DeviceCodeResponse,
  TokenResponse,
  UserInfoResponse,
} from "@core/auth/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

async function generateAndDisplayDeviceCode(): Promise<DeviceCodeResponse> {
  const deviceCodeResponse = await runTask(
    "Generating device code...",
    async () => {
      return await generateDeviceCode();
    },
    {
      successMessage: "Device code generated",
      errorMessage: "Failed to generate device code",
    }
  );

  log.info(
    `Verification code: ${theme.styles.bold(deviceCodeResponse.userCode)}` +
    `\nPlease confirm this code at: ${deviceCodeResponse.verificationUri}`
  );

  return deviceCodeResponse;
}

async function waitForAuthentication(
  deviceCode: string,
  expiresIn: number,
  interval: number
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
          }
        );
      },
      {
        successMessage: "Authentication completed!",
        errorMessage: "Authentication failed",
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      throw new Error("Authentication timed out. Please try again.");
    }
    throw error;
  }

  if (tokenResponse === undefined) {
    throw new Error("Failed to retrieve authentication token.");
  }

  return tokenResponse;
}

async function saveAuthData(
  response: TokenResponse,
  userInfo: UserInfoResponse
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

export async function login(): Promise<RunCommandResult> {
  const deviceCodeResponse = await generateAndDisplayDeviceCode();

  const token = await waitForAuthentication(
    deviceCodeResponse.deviceCode,
    deviceCodeResponse.expiresIn,
    deviceCodeResponse.interval
  );

  const userInfo = await getUserInfo(token.accessToken);

  await saveAuthData(token, userInfo);

  return { outroMessage: `Successfully logged in as ${theme.styles.bold(userInfo.email)}` };
}

export const loginCommand = new Command("login")
  .description("Authenticate with Base44")
  .action(async () => {
    await runCommand(login);
  });
