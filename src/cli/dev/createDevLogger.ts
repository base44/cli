import { theme } from "@/cli/utils/theme";

type LogType = "log" | "error" | "warn";

export interface Logger {
  log: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  warn: (msg: string) => void;
}

const dateTimeFormat = new Intl.DateTimeFormat([], {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const colorByType: Record<LogType, (text: string) => string> = {
  error: theme.styles.error,
  warn: theme.styles.warn,
  log: (text: string) => text,
};

export function createDevLogger(isPrefixed = true): Logger {
  const print = (type: LogType, msg: string) => {
    const colorize = colorByType[type];
    switch (type) {
      case "error":
        console.error(colorize(msg));
        break;
      case "warn":
        console.warn(colorize(msg));
        break;
      default:
        console.log(msg);
    }
  };

  const prefixedLog = (type: LogType, msg: string) => {
    const timestamp = dateTimeFormat.format(new Date());
    const colorize = colorByType[type];
    console.log(`${theme.styles.dim(timestamp)} ${colorize(msg)}`);
  };

  return isPrefixed
    ? {
        log: (msg: string) => prefixedLog("log", msg),
        error: (msg: string, err?: unknown) => {
          prefixedLog("error", msg);
          if (err) {
            prefixedLog("error", String(err));
          }
        },
        warn: (msg: string) => prefixedLog("warn", msg),
      }
    : {
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
