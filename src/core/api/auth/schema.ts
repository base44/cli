import { z } from "zod";

export const DeviceCodeResponseSchema = z.object({
  deviceCode: z.string().min(1, "Device code cannot be empty"),
  userCode: z.string().min(1, "User code cannot be empty"),
  verificationUrl: z.url("Invalid verification URL"),
  expiresIn: z.number().int().positive("Expires in must be a positive integer"),
});

export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>;

export const TokenResponseSchema = z.object({
  token: z.string().min(1, "Token cannot be empty"),
  email: z.email("Invalid email address"),
  name: z.string().min(1, "Name cannot be empty"),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;
