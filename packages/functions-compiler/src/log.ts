// One JSON object per line — Datadog auto-parses it into facets (logs arrive
// via Render Log Stream; no agent). `status` is Datadog's reserved level attribute.
// A host that owns its own output (the CLI) replaces the writer via `setLogSink`.

const SERVICE = process.env.DD_SERVICE;
const ENV = process.env.DD_ENV;
const VERSION = process.env.DD_VERSION;

export type Level = "info" | "warn" | "error";
export type Field = string | number | boolean | undefined;
export type LogSink = (
  level: Level,
  event: string,
  fields: Record<string, Field>,
) => void;

/** `undefined` fields are dropped so absent dimensions don't create empty facets. */
const jsonLineSink: LogSink = (level, event, fields) => {
  const line: Record<string, Field> = {
    status: level,
    service: SERVICE,
    env: ENV,
    version: VERSION,
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) line[key] = value;
  }
  if (level === "error") {
    console.error(JSON.stringify(line));
  } else if (level === "warn") {
    console.warn(JSON.stringify(line));
  } else {
    console.log(JSON.stringify(line));
  }
};

let sink: LogSink = jsonLineSink;

/** Route compiler diagnostics somewhere else; `null` restores the JSON writer.
 *  Must be called in the same thread that runs the compile. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? jsonLineSink;
}

export function logEvent(
  level: Level,
  event: string,
  fields: Record<string, Field> = {},
): void {
  sink(level, event, fields);
}
