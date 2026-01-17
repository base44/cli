import { format } from "node:util";
import { log } from "@clack/prompts";
import type { Interfaces } from "@oclif/core";

/**
 * Custom oclif logger that uses @clack/prompts for styled output.
 * This makes oclif's internal logs match our command output styling.
 */
export function createLogger(namespace: string): Interfaces.Logger {
  return {
    namespace,
    child: (ns: string, delimiter = ":") =>
      createLogger(`${namespace}${delimiter}${ns}`),
    debug: (formatter: unknown, ...args: unknown[]) => {
      if (process.env.DEBUG) {
        log.info(`[${namespace}] ${format(formatter, ...args)}`);
      }
    },
    error: (formatter: unknown, ...args: unknown[]) => {
      log.error(`[${namespace}] ${format(formatter, ...args)}`);
    },
    info: (formatter: unknown, ...args: unknown[]) => {
      log.info(format(formatter, ...args));
    },
    trace: (formatter: unknown, ...args: unknown[]) => {
      if (process.env.DEBUG) {
        log.info(`[${namespace}] ${format(formatter, ...args)}`);
      }
    },
    warn: (formatter: unknown, ...args: unknown[]) => {
      log.warn(format(formatter, ...args));
    },
  };
}

export const logger = createLogger("base44");
