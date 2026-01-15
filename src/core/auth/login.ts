import chalk from "chalk";
import { log } from "@clack/prompts";
import pWaitFor from "p-wait-for";
import { writeAuth } from "./config.js";
import {
  generateDeviceCode,
  getTokenFromDeviceCode,
  getUserInfo,
} from "./api.js";
import type {
  DeviceCodeResponse,
  TokenResponse,
  UserInfoResponse,
} from "./schema.js";

async function generateAndDisplayDeviceCode(): Promise<DeviceCodeResponse> {
  const deviceCodeResponse = await generateDeviceCode();

  log.info(
    `Verification code: ${chalk.bold(deviceCodeResponse.userCode)}` +
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
    log.step("Waiting for authentication...");

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

    log.success("Authentication completed!");
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

/**
 * Performs the complete login flow:
 * 1. Generates a device code
 * 2. Displays the verification code to the user
 * 3. Waits for the user to authenticate
 * 4. Retrieves the access token
 * 5. Fetches user info
 * 6. Saves authentication data
 *
 * This function can be called from the login command or automatically
 * from requireAuth() when authentication is needed.
 *
 * @throws {Error} If any step of the login flow fails.
 */
export async function performLogin(): Promise<void> {
  const deviceCodeResponse = await generateAndDisplayDeviceCode();

  const token = await waitForAuthentication(
    deviceCodeResponse.deviceCode,
    deviceCodeResponse.expiresIn,
    deviceCodeResponse.interval
  );

  const userInfo = await getUserInfo(token.accessToken);

  await saveAuthData(token, userInfo);

  log.success(`Successfully logged in as ${chalk.bold(userInfo.email)}`);
}
