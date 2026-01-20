import { printAnimatedLines } from "./animate.js";
import { ORANGE } from "./consts.js";
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
 * or fall back to static banner.
 */
export async function printBanner(): Promise<void> {
  if (process.stdout.isTTY) {
    await printAnimatedLines(BANNER_LINES);
  } else {
    console.log(ORANGE(BANNER_LINES.join("\n")));
  }
}
