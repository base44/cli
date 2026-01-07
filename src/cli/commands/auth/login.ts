import { Command } from "commander";
import { log } from "@clack/prompts";
import pWaitFor from "p-wait-for";
import {
  writeAuth,
  generateDeviceCode,
  getTokenFromDeviceCode,
} from "@core/auth/index.js";
import type { DeviceCodeResponse, TokenResponse } from "@core/auth/index.js";
import { runCommand, runTask } from "../../utils/index.js";

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
    `Please visit: ${deviceCodeResponse.verificationUrl}\n` +
      `Enter your device code: ${deviceCodeResponse.userCode}`
  );

  return deviceCodeResponse;
}

async function waitForAuthentication(
  deviceCode: string,
  expiresIn: number
): Promise<TokenResponse> {
  let tokenResponse: TokenResponse | undefined;

  try {
    await runTask(
      "Waiting for you to complete authentication...",
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
            interval: 2000,
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

async function saveAuthData(token: TokenResponse): Promise<void> {
  await writeAuth({
    token: token.token,
    email: token.email,
    name: token.name,
  });
}

async function login(): Promise<void> {
  const deviceCodeResponse = await generateAndDisplayDeviceCode();

  const token = await waitForAuthentication(
    deviceCodeResponse.deviceCode,
    deviceCodeResponse.expiresIn
  );

  await saveAuthData(token);

  log.success(`Logged in as ${token.name}`);
}

export const loginCommand = new Command("login")
  .description("Authenticate with Base44")
  .action(async () => {
    await runCommand(login);
  });
