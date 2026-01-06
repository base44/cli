import { z } from 'zod';

export const FunctionConfigSchema = z.looseObject({
  id: z.string().min(1, 'Function ID cannot be empty'),
  path: z.string().min(1, 'Function path cannot be empty'),
  enabled: z.boolean().default(true),
  triggers: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
});

export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;

