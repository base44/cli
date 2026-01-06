import { z } from "zod";

const HttpTriggerSchema = z.object({
  type: z.literal("http"),
  route: z.string().min(1, "Route cannot be empty"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
});

const ScheduleTriggerSchema = z.object({
  type: z.literal("schedule"),
  crontab: z.string().min(1, "Crontab expression cannot be empty"),
});

const TriggerSchema = z.discriminatedUnion("type", [
  HttpTriggerSchema,
  ScheduleTriggerSchema,
]);

export const FunctionConfigSchema = z.looseObject({
  name: z.string().min(1, "Function name cannot be empty"),
  triggers: z.array(TriggerSchema).optional(),
});

export type HttpTrigger = z.infer<typeof HttpTriggerSchema>;
export type ScheduleTrigger = z.infer<typeof ScheduleTriggerSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;

