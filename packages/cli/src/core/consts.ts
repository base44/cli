// Project structure
export const PROJECT_SUBDIR = "base44";
export const CONFIG_FILE_EXTENSION = "jsonc";
export const CONFIG_FILE_EXTENSION_GLOB = "{json,jsonc}";

/** Glob for discovering function config files at any depth under functions dir. */
export const FUNCTION_CONFIG_GLOB = `**/function.${CONFIG_FILE_EXTENSION_GLOB}`;

/** Glob for zero-config function entry files (any depth). */
export const ENTRY_FILE_GLOB = "**/entry.{js,ts}";

/**
 * Glob for source files bundled into a backend function's deploy payload —
 * used for both the function directory and the shared (`base44/shared/`) dir.
 */
export const BACKEND_FILE_GLOB = "**/*.{js,ts,json,jsonc}";

/**
 * Exclude paths where any segment contains a dot.
 */
export const ENTRY_IGNORE_DOT_PATHS = ["**/*.*/**"];

export const APP_CONFIG_PATTERN = `**/.app.${CONFIG_FILE_EXTENSION_GLOB}`;

export const PROJECT_CONFIG_PATTERNS = [
  `${PROJECT_SUBDIR}/config.${CONFIG_FILE_EXTENSION_GLOB}`,
  `config.${CONFIG_FILE_EXTENSION_GLOB}`,
];

// Environment variables
export const BASE44_APP_ID_ENV_VAR = "BASE44_APP_ID";

// Local development server
/**
 * Default port the local `base44 dev` server binds to. `exec --local` targets
 * this port unless `--port` is passed.
 * NOTE: keep in sync with `DEFAULT_PORT` in `cli/dev/dev-server/main.ts` (that
 * module owns the dev server and could later import this constant).
 */
export const DEFAULT_DEV_SERVER_PORT = 4400;

// Types generation
export const TYPES_OUTPUT_SUBDIR = ".types";
export const TYPES_FILENAME = "types.d.ts";

// Auth
export const AUTH_CLIENT_ID = "base44_cli";
