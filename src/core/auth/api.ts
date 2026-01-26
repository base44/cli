import { AuthApiError, AuthValidationError } from "@/core/errors.js";
import {
  DeviceCodeResponseSchema,
  TokenResponseSchema,
  OAuthErrorSchema,
  UserInfoSchema,
} from "@/core/auth/schema.js";
import type {
  DeviceCodeResponse,
  TokenResponse,
  UserInfoResponse,
} from "@/core/auth/schema.js";
import { AUTH_CLIENT_ID } from "@/core/consts.js";
import { oauthClient } from "@/core/clients/index.js";

export async function generateDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await oauthClient.post("oauth/device/code", {
    json: {
      client_id: AUTH_CLIENT_ID,
      scope: "apps:read apps:write",
    },
    throwHttpErrors: false,
  });

  if (!response.ok) {
    throw new AuthApiError(
      `Failed to generate device code: ${response.status} ${response.statusText}`
    );
  }

  const result = DeviceCodeResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new AuthValidationError(
      `Invalid device code response from server: ${result.error.message}`
    );
  }

  return result.data;
}

export async function getTokenFromDeviceCode(
  deviceCode: string
): Promise<TokenResponse | null> {
  const searchParams = new URLSearchParams();
  searchParams.set(
    "grant_type",
    "urn:ietf:params:oauth:grant-type:device_code"
  );
  searchParams.set("device_code", deviceCode);
  searchParams.set("client_id", AUTH_CLIENT_ID);

  const response = await oauthClient.post("oauth/token", {
    body: searchParams.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    throwHttpErrors: false,
  });

  const json = await response.json();

  if (!response.ok) {
    const errorResult = OAuthErrorSchema.safeParse(json);

    if (!errorResult.success) {
      throw new AuthValidationError(
        `Token request failed: ${errorResult.error.message}`
      );
    }

    const { error, error_description } = errorResult.data;

    // Polling states - user hasn't completed auth yet
    if (error === "authorization_pending" || error === "slow_down") {
      return null;
    }

    // Actual errors
    throw new AuthApiError(error_description ?? `OAuth error: ${error}`);
  }

  const result = TokenResponseSchema.safeParse(json);

  if (!result.success) {
    throw new AuthValidationError(
      `Invalid token response from server: ${result.error.message}`
    );
  }

  return result.data;
}

export async function renewAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("grant_type", "refresh_token");
  searchParams.set("refresh_token", refreshToken);
  searchParams.set("client_id", AUTH_CLIENT_ID);

  const response = await oauthClient.post("oauth/token", {
    body: searchParams.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    throwHttpErrors: false,
  });

  const json = await response.json();

  if (!response.ok) {
    const errorResult = OAuthErrorSchema.safeParse(json);

    if (!errorResult.success) {
      throw new AuthApiError(`Token refresh failed: ${response.statusText}`);
    }

    const { error, error_description } = errorResult.data;
    throw new AuthApiError(error_description ?? `OAuth error: ${error}`);
  }

  const result = TokenResponseSchema.safeParse(json);

  if (!result.success) {
    throw new AuthValidationError(
      `Invalid token response from server: ${result.error.message}`
    );
  }

  return result.data;
}

export async function getUserInfo(
  accessToken: string
): Promise<UserInfoResponse> {
  const response = await oauthClient.get("oauth/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new AuthApiError(`Failed to fetch user info: ${response.status}`);
  }

  const result = UserInfoSchema.safeParse(await response.json());

  if (!result.success) {
    throw new AuthValidationError(
      `Invalid UserInfo response from server: ${result.error.message}`
    );
  }

  return result.data;
}
