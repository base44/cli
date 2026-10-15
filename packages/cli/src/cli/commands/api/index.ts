import { Command } from "commander";
import { getApiCatalogCommand } from "./catalog.js";
import { getApiFetchCommand } from "./fetch.js";
import { getApiGrepCommand } from "./grep.js";
import { getApiSearchCommand } from "./search.js";

export function getApiCommand(): Command {
  return new Command("api")
    .description("Search and call any public Base44 API operation")
    .addCommand(getApiCatalogCommand())
    .addCommand(getApiSearchCommand())
    .addCommand(getApiGrepCommand())
    .addCommand(getApiFetchCommand());
}
