/**
 * Deno Exec Wrapper
 *
 * This script is executed by Deno to run user scripts with the Base44 SDK
 * pre-authenticated and available as a global `base44` variable.
 *
 * Environment variables:
 * - SCRIPT_PATH: Absolute path (or file:// URL) to the user's script
 * - BASE44_APP_ID: App identifier from .app.jsonc
 * - BASE44_ACCESS_TOKEN: User's access token
 * - BASE44_API_URL: API endpoint (default: https://app.base44.com)
 */

export {};

const scriptPath = Deno.env.get("SCRIPT_PATH");
const appId = Deno.env.get("BASE44_APP_ID");
const accessToken = Deno.env.get("BASE44_ACCESS_TOKEN");
const apiUrl = Deno.env.get("BASE44_API_URL");

if (!scriptPath) {
  console.error("SCRIPT_PATH environment variable is required");
  Deno.exit(1);
}

if (!appId || !accessToken) {
  console.error("BASE44_APP_ID and BASE44_ACCESS_TOKEN are required");
  Deno.exit(1);
}

import { createClient } from "npm:@base44/sdk";

const base44 = createClient({
  appId,
  token: accessToken,
  serverUrl: apiUrl || "https://app.base44.com",
});

(globalThis as any).base44 = base44;

try {
  await import(scriptPath);
} catch (error) {
  console.error("Failed to execute script:", error);
  Deno.exit(1);
}
