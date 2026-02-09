// Project structure
export const PROJECT_SUBDIR = "base44";
export const CONFIG_FILE_EXTENSION = "jsonc";
export const CONFIG_FILE_EXTENSION_GLOB = "{json,jsonc}";

export const FUNCTION_CONFIG_FILE = `function.${CONFIG_FILE_EXTENSION_GLOB}`;

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
