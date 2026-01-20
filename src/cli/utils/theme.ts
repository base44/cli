import chalk from "chalk";

/**
 * Base44 CLI theme configuration
 */
export const theme = {
  colors: {
    base44Orange: chalk.hex("#E86B3C"),
    shinyOrange: chalk.hex("#FFD700"),
    links: chalk.hex("#00D4FF"),
    white: chalk.white
  },
  styles: {
    header: chalk.dim,
    bold: chalk.bold,
    dim: chalk.dim
  }
};
