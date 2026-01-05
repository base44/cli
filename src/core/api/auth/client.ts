import {
  DeviceCodeResponseSchema,
  type DeviceCodeResponse,
  TokenResponseSchema,
  type TokenResponse,
} from "./schema.js";
import { AuthApiError, AuthValidationError } from "@core/errors/index.js";

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const deviceCodeToTokenMap = new Map<
  string,
  { startTime: number; readyAfter: number }
>();

export async function generateDeviceCode(): Promise<DeviceCodeResponse> {
  try {
    await delay(1000);

    const deviceCode = `device-code-${Date.now()}`;

    deviceCodeToTokenMap.set(deviceCode, {
      startTime: Date.now(),
      readyAfter: 5000,
    });

    const mockResponse: DeviceCodeResponse = {
      deviceCode,
      userCode: "ABCD-1234",
      verificationUrl: "https://app.base44.com/verify",
      expiresIn: 600,
    };

    const result = DeviceCodeResponseSchema.safeParse(mockResponse);
    if (!result.success) {
      throw new AuthValidationError(
        "Invalid device code response from server",
        result.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.map(String),
        }))
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof AuthValidationError) {
      throw error;
    }
    throw new AuthApiError(
      "Failed to generate device code",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function getTokenFromDeviceCode(
  deviceCode: string
): Promise<TokenResponse | null> {
  try {
    await delay(1000);

    const deviceInfo = deviceCodeToTokenMap.get(deviceCode);

    if (!deviceInfo) {
      return null;
    }

    const elapsed = Date.now() - deviceInfo.startTime;

    if (elapsed < deviceInfo.readyAfter) {
      return null;
    }

    const mockResponse: TokenResponse = {
      token: "mock-token-" + Date.now(),
      email: "stam@lala.com",
      name: "Test User",
    };

    const result = TokenResponseSchema.safeParse(mockResponse);
    if (!result.success) {
      throw new AuthValidationError(
        "Invalid token response from server",
        result.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.map(String),
        }))
      );
    }

    deviceCodeToTokenMap.delete(deviceCode);
    return result.data;
  } catch (error) {
    if (error instanceof AuthValidationError || error instanceof AuthApiError) {
      throw error;
    }
    throw new AuthApiError(
      "Failed to retrieve token from device code",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
