import { z } from "zod";

const NameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,63}$/,
    "Name must use lowercase letters, numbers, and underscores",
  );

export const UserSecretDefinitionSchema = z.object({
  name: NameSchema,
  label: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional().default(""),
  allowedFunctions: z.array(z.string().min(1)).min(1).max(50),
});

export type UserSecretDefinition = z.infer<typeof UserSecretDefinitionSchema>;

export const UserSecretDefinitionResponseSchema = z.object({
  id: z.string(),
  key: NameSchema,
  label: z.string(),
  description: z.string(),
  allowed_backend_functions: z.array(z.string()),
  version: z.number(),
  is_active: z.boolean(),
});

export const SyncUserSecretsResponseSchema = z.array(
  UserSecretDefinitionResponseSchema,
);
