import { z } from "zod";

/**
 * Schema for CLI telemetry events sent to Mixpanel.
 * Based on the BI event structure for CLI tracking.
 */
export const CLIEventSchema = z.object({
  // User identification (used as distinct_id in Mixpanel)
  user_id: z.string().optional(),

  // CLI context
  cli_version: z.string(),
  command: z.string(),
  sub_command: z.string().optional(),

  // App context
  app_id: z.string().optional(),

  // Session tracking
  session_id: z.string(),

  // Interaction details
  question: z.string().optional(),
  answer: z.string().optional(),

  // Flow and command metadata
  flow: z.string().optional(),
  additional_command_info: z.string().optional(),

  // Result tracking
  session_end: z.enum(["success", "stopped", "failed", "error"]).optional(),

  // Technical metadata
  duration_ms: z.number().optional(),
  success: z.boolean().optional(),
  error_message: z.string().optional(),
  os: z.string().optional(),
  node_version: z.string().optional(),
});

export type CLIEvent = z.infer<typeof CLIEventSchema>;

/**
 * Event names for different tracking scenarios
 */
export const EventNames = {
  COMMAND_STARTED: "cli_command_started",
  COMMAND_COMPLETED: "cli_command_completed",
  COMMAND_FAILED: "cli_command_failed",
  SESSION_STARTED: "cli_session_started",
  SESSION_ENDED: "cli_session_ended",
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];
