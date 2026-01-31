import chalk from "chalk";
import type { ErrorContext } from "@/cli/telemetry/error-reporter.js";
import type { ErrorHint } from "@/core/errors.js";

/**
 * Base44 CLI theme configuration
 */
export const theme = {
  colors: {
    base44Orange: chalk.hex("#E86B3C"),
    base44OrangeBackground: chalk.bgHex("#E86B3C"),
    shinyOrange: chalk.hex("#FFD700"),
    links: chalk.hex("#00D4FF"),
    white: chalk.white
  },
  styles: {
    header: chalk.dim,
    bold: chalk.bold,
    dim: chalk.dim
  },
  format: {
    errorContext(ctx: ErrorContext): string {
      const parts = [
        ctx.sessionId ? `Session: ${ctx.sessionId}` : null,
        ctx.appId ? `App: ${ctx.appId}` : null,
        new Date().toISOString(),
      ].filter(Boolean);
      return chalk.dim(parts.join(" | "));
    },
    agentHints(hints: ErrorHint[]): string | null {
      if (hints.length === 0) {
        return null;
      }

      const hintLines = hints.map((hint) => {
        if (hint.command) {
          return `  Run: ${hint.command}`;
        }
        return `  ${hint.message}`;
      });

      return ["[Agent Hints]", ...hintLines].join("\n");
    }
  }
};
