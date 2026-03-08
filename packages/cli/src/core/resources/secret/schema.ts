import { z } from "zod";

export const ListSecretsResponseSchema = z.record(z.string(), z.string());

export type ListSecretsResponse = z.infer<typeof ListSecretsResponseSchema>;

export const SetSecretsResponseSchema = z.object({
  success: z.boolean(),
});

export type SetSecretsResponse = z.infer<typeof SetSecretsResponseSchema>;

export const DeleteSecretResponseSchema = z.object({
  success: z.boolean(),
});

export type DeleteSecretResponse = z.infer<typeof DeleteSecretResponseSchema>;
