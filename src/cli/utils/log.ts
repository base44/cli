/**
 * Wrapped @clack/prompts log that auto-suppresses in JSON mode.
 *
 * Import `log` from this file (via utils/index.ts) instead of @clack/prompts
 * to automatically suppress output when --json flag is used.
 */
import { log as clackLog } from "@clack/prompts";
import { isJsonMode } from "./json.js";

type LogMessage = typeof clackLog.message;
type LogInfo = typeof clackLog.info;

function wrapMessage(method: LogMessage): LogMessage {
  return (message, opts) => {
    if (!isJsonMode()) {
      method(message, opts);
    }
  };
}

function wrapSimple(method: LogInfo): LogInfo {
  return (message) => {
    if (!isJsonMode()) {
      method(message);
    }
  };
}

export const log = {
  message: wrapMessage(clackLog.message),
  info: wrapSimple(clackLog.info),
  success: wrapSimple(clackLog.success),
  step: wrapSimple(clackLog.step),
  warn: wrapSimple(clackLog.warn),
  warning: wrapSimple(clackLog.warning),
  error: wrapSimple(clackLog.error),
};
