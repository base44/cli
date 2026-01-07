import { join } from "node:path";
import { homedir } from "node:os";

export const PROJECT_SUBDIR = "base44";
export const FUNCTION_CONFIG_FILE = "function.jsonc";

export function getBase44Dir() {
  return join(homedir(), ".base44");
}

export function getAuthFilePath() {
  return join(getBase44Dir(), "auth", "auth.json");
}

export function getProjectConfigPatterns() {
  return [
    `${PROJECT_SUBDIR}/config.jsonc`,
    `${PROJECT_SUBDIR}/config.json`,
    "config.jsonc",
    "config.json",
  ];
}
