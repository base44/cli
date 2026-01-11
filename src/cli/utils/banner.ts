import chalk from "chalk";

const orange = chalk.hex("#E86B3C");
const dim = chalk.dim;

// ASCII art banner for Base44
const BANNER = `
${orange("██████╗  █████╗ ███████╗███████╗ ██╗  ██╗██╗  ██╗")}
${orange("██╔══██╗██╔══██╗██╔════╝██╔════╝ ██║  ██║██║  ██║")}
${orange("██████╔╝███████║███████╗█████╗   ███████║███████║")}
${orange("██╔══██╗██╔══██║╚════██║██╔══╝   ╚════██║╚════██║")}
${orange("██████╔╝██║  ██║███████║███████╗      ██║     ██║")}
${orange("╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝      ╚═╝     ╚═╝")}
`;

export function printBanner(): void {
  console.log(BANNER);
}
