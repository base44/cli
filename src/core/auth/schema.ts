import { z } from "zod";

export const AuthDataSchema = z.object({
  accessToken: z.string().min(1, "Token cannot be empty"),
  refreshToken: z.string().min(1, "Refresh token cannot be empty"),
  expiresAt: z.number().int().positive("Expires at must be a positive integer"),
  email: z.email(),
  name: z.string().min(1, "Name cannot be empty"),
});

export type AuthData = z.infer<typeof AuthDataSchema>;

export const DeviceCodeResponseSchema = z
  .object({
    device_code: z.string().min(1, "Device code cannot be empty"),
    user_code: z.string().min(1, "User code cannot be empty"),
    verification_uri: z.url("Invalid verification URL"),
    verification_uri_complete: z.url("Invalid complete verification URL"),
    expires_in: z
      .number()
      .int()
      .positive("Expires in must be a positive integer"),
    interval: z
      .number()
      .int()
      .positive("Interval in must be a positive integer"),
  })
  .transform((data) => ({
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval,
  }));

export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>;

export const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1, "Token cannot be empty"),
    token_type: z.string().min(1, "Token type cannot be empty"),
    expires_in: z
      .number()
      .int()
      .positive("Expires in must be a positive integer"),
    refresh_token: z.string().min(1, "Refresh token cannot be empty"),
    scope: z.string().optional(),
  })
  .transform((data) => ({
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
    scope: data.scope,
  }));

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const OAuthErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export type OAuthError = z.infer<typeof OAuthErrorSchema>;

export const UserInfoSchema = z.object({
  email: z.email(),
  name: z.string(),
});

export type UserInfoResponse = z.infer<typeof UserInfoSchema>;
