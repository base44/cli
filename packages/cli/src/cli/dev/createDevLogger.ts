import { theme } from "@/cli/utils/theme";

type LogType = "log" | "error" | "warn";

export interface DevLogger {
  log: (...args: unknown[]) => void;
  error: (msg: string, err?: unknown) => void;
  warn: (...args: unknown[]) => void;
}

const colorByType: Record<LogType, (text: string) => string> = {
  error: theme.styles.error,
  warn: theme.styles.warn,
  log: (text: string) => text,
};

const stringify = (item: unknown): string => {
  if (typeof item === "string") {
    return item;
  }
  if (item instanceof Error) {
    return item.toString();
  }
  return JSON.stringify(item) ?? String(item);
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
    error: (msg: string, err?: unknown) => {
      print("error", msg);
      if (err) {
        print("error", String(err));
      }
    },
    warn: (...args: unknown[]) => print("warn", ...args),
  };
}
