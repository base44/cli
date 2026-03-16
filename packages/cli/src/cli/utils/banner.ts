import { printAnimatedLines } from "@/cli/utils/animate.js";

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
export async function printBanner(): Promise<void> {
  await printAnimatedLines(BANNER_LINES);
}
