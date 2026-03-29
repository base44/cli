import { theme } from "@/cli/utils/theme";

type LogType = "log" | "error" | "warn";

export interface DevLogger {
  log: (...args: unknown[]) => void;
  error: (msg: unknown, err?: unknown) => void;
  warn: (...args: unknown[]) => void;
}

const colorByType: Record<LogType, (text: unknown) => unknown> = {
  error: theme.styles.error,
  warn: theme.styles.warn,
  log: (input: unknown) => input,
};

const stringify = (item: unknown): string => {
  if (typeof item === "string") {
    return item;
  }
  if (item instanceof Error) {
    return item.toString();
  }
  try {
    return JSON.stringify(item, null, 2) ?? String(item);
  } catch {
    return String(item);
  }
};

export function createDevLogger(): DevLogger {
  const print = (type: LogType, ...args: unknown[]) => {
    const colorize = colorByType[type];
    console[type](
      ...args.map((item) => {
        return colorize(stringify(item));
      }),
    );
  };

  return {
    log: (...args: unknown[]) => print("log", ...args),
    error: (msg: unknown, err?: unknown) => {
      print("error", msg);
      if (err) {
        print("error", err);
      }
    },
    warn: (...args: unknown[]) => print("warn", ...args),
  };
}
