/** Characters every shell reads literally; anything else gets quoted. */
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

function quote(arg: string, platform: NodeJS.Platform): string {
  if (SHELL_SAFE.test(arg)) {
    return arg;
  }
  if (platform === "win32") {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * The serveCommand with the caller's arguments appended, each one reaching the
 * dev server as one argument. Appended verbatim otherwise: the caller knows its
 * command's shape, e.g. `npm run dev` needs its own `--` before script flags.
 */
export function appendServeArgs(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): string {
  return [command, ...args.map((arg) => quote(arg, platform))].join(" ");
}
