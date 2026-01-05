import { Command } from "commander";
import { log, spinner } from "@clack/prompts";
import pWaitFor from "p-wait-for";
import { writeAuth } from "@config/auth.js";
import {
  generateDeviceCode,
  getTokenFromDeviceCode,
  AuthApiError,
  AuthValidationError,
  type DeviceCodeResponse,
  type TokenResponse,
} from "@api/auth";
import { runCommand } from "../../utils/index.js";

async function generateAndDisplayDeviceCode(): Promise<DeviceCodeResponse> {
  const s = spinner();
  s.start("Generating device code...");

  try {
    const deviceCodeResponse = await generateDeviceCode();
    s.stop("Device code generated");

    log.info(
      `Please visit: ${deviceCodeResponse.verificationUrl}\n` +
        `Enter your device code: ${deviceCodeResponse.userCode}`
    );

    return deviceCodeResponse;
  } catch (error) {
    s.stop("Failed to generate device code");
    if (error instanceof AuthValidationError) {
      const issues = error.issues.map((i) => i.message).join(", ");
      throw new Error(`Invalid response from server: ${issues}`);
    }
    if (error instanceof AuthApiError) {
      throw new Error(`Failed to generate device code: ${error.message}`);
    }
    throw new Error(
      `Unexpected error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function waitForAuthentication(
  deviceCode: string,
  expiresIn: number
): Promise<TokenResponse> {
  const s = spinner();
  s.start("Waiting for you to complete authentication...");

  let tokenResponse: TokenResponse | null = null;

  try {
    await pWaitFor(
      async () => {
        try {
          const result = await getTokenFromDeviceCode(deviceCode);
          if (result !== null) {
            tokenResponse = result;
            return true;
          }
          return false;
        } catch (error) {
          if (error instanceof AuthValidationError) {
            const issues = error.issues.map((i) => i.message).join(", ");
            throw new Error(`Invalid response from server: ${issues}`);
          }
          if (error instanceof AuthApiError) {
            throw new Error(`API error: ${error.message}`);
          }
          throw error;
        }
      },
      {
        interval: 2000,
        timeout: expiresIn * 1000,
      }
    );
  } catch (error) {
    s.stop("Authentication failed");
    if (error instanceof Error && error.message.includes("timed out")) {
      throw new Error("Authentication timed out. Please try again.");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unexpected error during authentication");
  }

  s.stop("Authentication completed!");

  if (!tokenResponse) {
    throw new Error("Failed to retrieve authentication token.");
  }

  return tokenResponse;
}

async function saveAuthData(token: TokenResponse): Promise<void> {
  try {
    await writeAuth({
      token: token.token,
      email: token.email,
      name: token.name,
    });
  } catch (error) {
    throw new Error(
      `Failed to save authentication data: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
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
