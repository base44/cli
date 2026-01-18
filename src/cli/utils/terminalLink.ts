import terminalLink from "terminal-link";
import chalk from "chalk";

/**
 * Creates a clickable terminal link if supported, otherwise falls back to
 * a formatted link with chalk underline.
 *
 * @param text - The text to display
 * @param url - The URL to link to
 * @returns A terminal link if supported, otherwise chalk-formatted text
 */
export function createLink(text: string, url: string): string {
  // terminal-link automatically detects support and returns fallback if needed
  // We customize the fallback to use chalk with underline
  return terminalLink(text, url, {
    fallback: (text, url) => {
      return `${chalk.underline.blue(url)}`;
    },
  });
}

/**
 * Checks if the current terminal supports clickable links.
 * This uses terminal-link's internal detection mechanism.
 *
 * @returns true if terminal supports links, false otherwise
 */
export function supportsLinks(): boolean {
  // terminal-link has a isSupported property but it's not exported
  // We can detect support by checking if the terminal supports hyperlinks
  // Common detection: iTerm2, VSCode terminal, GNOME terminal, etc.
  return (
    process.env.TERM_PROGRAM === "iTerm.app" ||
    process.env.TERM_PROGRAM === "vscode" ||
    process.env.TERM === "xterm-256color" ||
    process.env.WT_SESSION !== undefined || // Windows Terminal
    Boolean(process.env.KONSOLE_VERSION) ||
    Boolean(process.env.VTE_VERSION)
  );
}
