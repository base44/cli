import type { Logger } from "@base44-cli/logger";
import { theme } from "@/cli/utils/index.js";

export function toJsonStdout(result: unknown): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** "URL: https://my-app.base44.app" — the slug-derived production URL line. */
export function logAppUrl(url: string, log: Logger): void {
  log.message(`${theme.styles.header("URL")}: ${theme.colors.links(url)}`);
}
