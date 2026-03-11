// Project structure
export const PROJECT_SUBDIR = "base44";
export const CONFIG_FILE_EXTENSION = "jsonc";
export const CONFIG_FILE_EXTENSION_GLOB = "{json,jsonc}";

/** Glob for discovering function config files at any depth under functions dir. */
export const FUNCTION_CONFIG_GLOB = `**/function.${CONFIG_FILE_EXTENSION_GLOB}`;

/** Glob for zero-config function entry files (any depth). */
export const ENTRY_FILE_GLOB = "**/entry.{js,ts}";

/**
 * Exclude paths where any segment contains a dot.
 */
export const ENTRY_IGNORE_DOT_PATHS = ["**/*.*/**"];

export const APP_CONFIG_PATTERN = `**/.app.${CONFIG_FILE_EXTENSION_GLOB}`;

export const PROJECT_CONFIG_PATTERNS = [
  `${PROJECT_SUBDIR}/config.${CONFIG_FILE_EXTENSION_GLOB}`,
  `config.${CONFIG_FILE_EXTENSION_GLOB}`,
];

// Types generation
export const TYPES_OUTPUT_SUBDIR = ".types";
export const TYPES_FILENAME = "types.d.ts";

// Auth
export const AUTH_CLIENT_ID = "base44_cli";
