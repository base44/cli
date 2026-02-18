import { theme } from "@/cli/utils/theme";

type LogType = "log" | "error" | "warn";

export interface Logger {
  log: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  warn: (msg: string) => void;
}

const colorByType: Record<LogType, (text: string) => string> = {
  error: theme.styles.error,
  warn: theme.styles.warn,
  log: (text: string) => text,
};

export function createDevLogger(): Logger {
  const print = (type: LogType, msg: string) => {
    const colorize = colorByType[type];
    console[type](colorize(msg));
  };

  return {
    log: (msg: string) => print("log", msg),
    error: (msg: string, err?: unknown) => {
      print("error", msg);
      if (err) {
        print("error", String(err));
      }
    },
    warn: (msg: string) => print("warn", msg),
  };
}
