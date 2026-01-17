import chalk from "chalk";
import { printAnimatedLines } from "./animate.js";

const orange = chalk.hex("#E86B3C");
const BANNER_LINES = [
  "",
  "██████╗  █████╗ ███████╗███████╗ ██╗  ██╗██╗  ██╗",
  "██╔══██╗██╔══██╗██╔════╝██╔════╝ ██║  ██║██║  ██║",
  "██████╔╝███████║███████╗█████╗   ███████║███████║",
  "██╔══██╗██╔══██║╚════██║██╔══╝   ╚════██║╚════██║",
  "██████╔╝██║  ██║███████║███████╗      ██║     ██║",
  "╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝      ╚═╝     ╚═╝",
  "",
];

/**
 * Print the Base44 banner with smooth animation if supported,
 * or fall back to static banner.
 */
export async function printBanner(): Promise<void> {
  if (process.stdout.isTTY) {
    await printAnimatedLines(BANNER_LINES);
  } else {
    console.log(orange(BANNER_LINES.join("\n")));
  }
}
