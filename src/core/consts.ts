// Project structure
export const PROJECT_SUBDIR = "base44";
export const FUNCTION_CONFIG_FILE = "function.jsonc";
export function getProjectConfigPatterns(): string[] {
  return [
    `${PROJECT_SUBDIR}/config.jsonc`,
    `${PROJECT_SUBDIR}/config.json`,
    "config.jsonc",
    "config.json",
  ];
}

// Auth
export const AUTH_CLIENT_ID = "base44_cli";
