import type { Command } from "commander";
import { Base44Command } from "@/cli/utils/index.js";
import { getSlugResetCommand } from "./reset.js";
import { getSlugSetCommand } from "./set.js";
import { showSlugAction } from "./show.js";

export function getSlugCommand(): Command {
  return new Base44Command("slug")
    .description("Show or change the app's URL slug (its public subdomain)")
    .allowExcessArguments(false)
    .action(showSlugAction)
    .addCommand(getSlugSetCommand())
    .addCommand(getSlugResetCommand());
}
