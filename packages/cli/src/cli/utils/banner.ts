import { printAnimatedLines } from "@/cli/utils/animate.js";
import { theme } from "@/cli/utils/theme.js";

const BANNER_LINES = [
  "██████╗  █████╗ ███████╗███████╗ ██╗  ██╗██╗  ██╗",
  "██╔══██╗██╔══██╗██╔════╝██╔════╝ ██║  ██║██║  ██║",
  "██████╔╝███████║███████╗█████╗   ███████║███████║",
  "██╔══██╗██╔══██║╚════██║██╔══╝   ╚════██║╚════██║",
  "██████╔╝██║  ██║███████║███████╗      ██║     ██║",
  "╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝      ╚═╝     ╚═╝",
];

/**
 * Print the Base44 banner with smooth animation if supported,
 * or fall back to static banner in non-interactive environments.
 */
export async function printBanner(isNonInteractive: boolean): Promise<void> {
  if (isNonInteractive) {
    console.log(theme.colors.base44Orange(BANNER_LINES.join("\n")));
  } else {
    await printAnimatedLines(BANNER_LINES);
  }
}
