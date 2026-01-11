import { join } from "node:path";
import { homedir } from "node:os";
import { config } from "dotenv";

// Static constants
export const PROJECT_SUBDIR = "base44";
export const FUNCTION_CONFIG_FILE = "function.jsonc";
export const AUTH_CLIENT_ID = "base44_cli";

const DEFAULT_API_URL = "https://app.base44.com";

// Path helpers
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

/**
 * Load .env.local from the project root if it exists.
 * Values won't override existing process.env variables.
 * Safe to call multiple times - only loads once.
 */
export async function loadProjectEnv(projectRoot?: string): Promise<void> {
  // Avoid circular dependency - inline the project root finding
  const { findProjectRoot } = await import("./project/config.js");
  const found = projectRoot ? { root: projectRoot } : await findProjectRoot();

  if (!found) {
    return;
  }

  const envPath = join(found.root, ".env.local");
  config({ path: envPath, override: false });
}

/**
 * Get the Base44 API URL.
 * Priority: process.env.BASE44_API_URL > .env.local > default
 */
export function getBase44ApiUrl(): string {
  return process.env.BASE44_API_URL || DEFAULT_API_URL;
}

/**
 * Get the Base44 Client ID (app ID).
 * Priority: process.env.BASE44_CLIENT_ID > .env.local
 * Returns undefined if not set.
 */
export function getBase44ClientId(): string | undefined {
  return process.env.BASE44_CLIENT_ID;
}
