import { z } from "zod";

export const AuthDataSchema = z.object({
  token: z.string().min(1, "Token cannot be empty"),
  email: z.email(),
  name: z.string().min(1, "Name cannot be empty"),
});

export type AuthData = z.infer<typeof AuthDataSchema>;
