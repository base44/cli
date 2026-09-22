/**
 * What to run when a project has a site but names no dev server. Not a schema
 * default: `base44 dev` reads an absent `serveCommand` as "no frontend to run
 * here", so only a command that exists purely to serve one may assume this.
 */
export const DEFAULT_SERVE_COMMAND = "npm run dev";

/** An npm script invocation, optionally prefixed to a subdirectory. Only these
 * forward extra args to the underlying dev server through `--`. */
const NPM_RUN_COMMAND = /^npm(\s+--prefix\s+\S+)?\s+run\s+\S+$/;

export interface ServeAddress {
  /** Address to bind, e.g. `0.0.0.0` so something outside the machine can reach it. */
  host?: string;
  port?: number;
  /** How this dev server spells its bind-address flag. */
  hostFlag: string;
}

/**
 * `serveCommand` with a bind address appended, or unchanged when there is
 * nothing to append or no way to append it.
 *
 * Only an `npm run` invocation gets the arguments: `--` is what forwards them
 * to the script, and a bare binary (`vite`, `next dev`) would read a literal
 * `--` as its own. Callers that need a specific address on a command outside
 * that shape have to put it in `serveCommand` themselves.
 */
export function withServeAddress(
  serveCommand: string,
  { host, port, hostFlag }: ServeAddress,
): string {
  const args = [
    ...(host ? [hostFlag, host] : []),
    ...(port === undefined ? [] : ["--port", String(port)]),
  ];
  if (args.length === 0 || !NPM_RUN_COMMAND.test(serveCommand.trim())) {
    return serveCommand;
  }
  return `${serveCommand} -- ${args.join(" ")}`;
}

export function forwardsServeAddress(serveCommand: string): boolean {
  return NPM_RUN_COMMAND.test(serveCommand.trim());
}
