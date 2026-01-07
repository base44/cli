import { z } from "zod";

const HttpTriggerSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.literal("http"),
  path: z.string().min(1, "Path cannot be empty"),
});

const ScheduleTriggerSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.literal("schedule"),
  scheduleMode: z.enum(["recurring", "once"]).optional(),
  cron: z.string().min(1, "Cron expression cannot be empty"),
  isActive: z.boolean().optional(),
  timezone: z.string().optional(),
});

const EventTriggerSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.literal("event"),
  entity: z.string().min(1, "Entity name cannot be empty"),
  event: z.string().min(1, "Event type cannot be empty"),
});

const TriggerSchema = z.discriminatedUnion("type", [
  HttpTriggerSchema,
  ScheduleTriggerSchema,
  EventTriggerSchema,
]);

export const FunctionConfigSchema = z.object({
  entry: z.string().min(1, "Entry point cannot be empty"),
  triggers: z.array(TriggerSchema).optional(),
});

export type HttpTrigger = z.infer<typeof HttpTriggerSchema>;
export type ScheduleTrigger = z.infer<typeof ScheduleTriggerSchema>;
export type EventTrigger = z.infer<typeof EventTriggerSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;

