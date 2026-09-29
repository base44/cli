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
 * - BASE44_APP_BASE_URL: App's published URL / subdomain (used for function calls)
 * - BASE44_PRIVILEGED: When "true", adds the X-Bypass-RLS header (bypass RLS)
 * - BASE44_DATA_ENV: When set, adds the X-Data-Env header (target data environment)
 * - BASE44_SERVICE_TOKEN: When set, passed as `serviceToken` (enables `base44.asServiceRole`)
 *
 * BASE44_SERVICE_TOKEN is removed from the environment before the user script runs.
 */

export {};

const scriptPath = Deno.env.get("SCRIPT_PATH");
const appId = Deno.env.get("BASE44_APP_ID");
const accessToken = Deno.env.get("BASE44_ACCESS_TOKEN");
const appBaseUrl = Deno.env.get("BASE44_APP_BASE_URL");
const isPrivileged = Deno.env.get("BASE44_PRIVILEGED") === "true";
const dataEnv = Deno.env.get("BASE44_DATA_ENV");
const serviceToken = Deno.env.get("BASE44_SERVICE_TOKEN");
Deno.env.delete("BASE44_SERVICE_TOKEN");

if (!scriptPath) {
  console.error("SCRIPT_PATH environment variable is required");
  Deno.exit(1);
}

if (!appId || !accessToken) {
  console.error("BASE44_APP_ID and BASE44_ACCESS_TOKEN are required");
  Deno.exit(1);
}

if (!appBaseUrl) {
  console.error("BASE44_APP_BASE_URL environment variable is required");
  Deno.exit(1);
}

// Exact version: an unversioned specifier makes Deno resolve "latest" from npm on
// every fresh cache, so a pre-cached SDK is never used.
import { createClient } from "npm:@base44/sdk@0.8.48";

const customHeaders: Record<string, string> = {};
if (isPrivileged) customHeaders["X-Bypass-RLS"] = "true";
if (dataEnv) customHeaders["X-Data-Env"] = dataEnv;

const base44 = createClient({
  appId,
  token: accessToken,
  ...(serviceToken ? { serviceToken } : {}),
  serverUrl: appBaseUrl,
  headers: customHeaders,
});

(globalThis as any).base44 = base44;

try {
  await import(scriptPath);
} catch (error) {
  console.error("Failed to execute script:", error);
  Deno.exit(1);
} finally {
  // Clean up the SDK client (clears analytics heartbeat interval,
  // disconnects socket) so the process can exit naturally.
  base44.cleanup();
}
