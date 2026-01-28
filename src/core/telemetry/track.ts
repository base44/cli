import { getMixpanelClient, isTelemetryEnabled } from "./client.js";
import { getSessionId, getOS, getNodeVersion } from "./session.js";
import { EventNames } from "./types.js";
import type { CLIEvent, EventName } from "./types.js";
import packageJson from "../../../package.json";

const cliVersion = packageJson.version;

export interface TrackCommandOptions {
  command: string;
  subCommand?: string;
  appId?: string;
  userId?: string;
  flow?: string;
  additionalInfo?: string;
  question?: string;
  answer?: string;
}

export interface TrackCommandResultOptions extends TrackCommandOptions {
  success: boolean;
  durationMs: number;
  errorMessage?: string;
  sessionEnd?: CLIEvent["session_end"];
}

/**
 * Build the base event properties common to all events.
 */
function buildBaseEventProperties(options: TrackCommandOptions): CLIEvent {
  return {
    cli_version: cliVersion,
    command: options.command,
    sub_command: options.subCommand,
    app_id: options.appId,
    user_id: options.userId,
    session_id: getSessionId(),
    flow: options.flow,
    additional_command_info: options.additionalInfo,
    question: options.question,
    answer: options.answer,
    os: getOS(),
    node_version: getNodeVersion(),
  };
}

/**
 * Track a generic event to Mixpanel.
 * This is a low-level function - prefer using the specific track* functions.
 */
export function trackEvent(
  eventName: EventName,
  properties: CLIEvent
): void {
  if (!isTelemetryEnabled()) {
    return;
  }

  const client = getMixpanelClient();
  if (!client) {
    return;
  }

  // Use user_id as distinct_id if available, otherwise use session_id
  const distinctId = properties.user_id || properties.session_id;

  client.track(eventName, {
    distinct_id: distinctId,
    ...properties,
  });
}

/**
 * Track when a command starts execution.
 */
export function trackCommandStarted(options: TrackCommandOptions): void {
  const properties = buildBaseEventProperties(options);
  trackEvent(EventNames.COMMAND_STARTED, properties);
}

/**
 * Track when a command completes (success or failure).
 */
export function trackCommandCompleted(options: TrackCommandResultOptions): void {
  const properties: CLIEvent = {
    ...buildBaseEventProperties(options),
    success: options.success,
    duration_ms: options.durationMs,
    error_message: options.errorMessage,
    session_end: options.sessionEnd,
  };

  const eventName = options.success
    ? EventNames.COMMAND_COMPLETED
    : EventNames.COMMAND_FAILED;

  trackEvent(eventName, properties);
}

/**
 * Track a CLI session start.
 */
export function trackSessionStarted(userId?: string): void {
  const properties: CLIEvent = {
    cli_version: cliVersion,
    command: "session",
    session_id: getSessionId(),
    user_id: userId,
    os: getOS(),
    node_version: getNodeVersion(),
  };

  trackEvent(EventNames.SESSION_STARTED, properties);
}

/**
 * Track a CLI session end.
 */
export function trackSessionEnded(
  sessionEnd: CLIEvent["session_end"],
  userId?: string
): void {
  const properties: CLIEvent = {
    cli_version: cliVersion,
    command: "session",
    session_id: getSessionId(),
    user_id: userId,
    session_end: sessionEnd,
    os: getOS(),
    node_version: getNodeVersion(),
  };

  trackEvent(EventNames.SESSION_ENDED, properties);
}
