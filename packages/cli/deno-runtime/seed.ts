/**
 * Deno Seed Wrapper
 *
 * Executed by Deno to run a project's `base44/seed.ts` programmatic seed
 * hook. Builds a `ctx` object and calls the script's default export with it:
 *
 * - `ctx.base44`  — SDK client bound to the LOCAL dev server as service role
 *   (bypasses RLS/FLS; the local server resolves the service-subject JWT in
 *   the Authorization header to its service principal).
 * - `ctx.remote({ dataEnv? })` — factory for SDK clients authenticated as the
 *   CLI user against the linked REMOTE app. `dataEnv: "dev"` targets the dev
 *   data environment via the `X-Data-Env` header.
 * - `ctx.log(msg)` — stderr logger (stdout is reserved for the CLI).
 *
 * Environment variables:
 * - SCRIPT_PATH: file:// URL of the user's seed script
 * - BASE44_APP_ID: App identifier
 * - BASE44_LOCAL_URL: Base URL of the running local dev server
 * - BASE44_LOCAL_SERVICE_TOKEN: Local service-role JWT
 * - BASE44_ACCESS_TOKEN: Remote app-user token (may be empty)
 * - BASE44_APP_BASE_URL: Remote app's published URL (may be empty)
 * - BASE44_REMOTE_ERROR: Reason remote credentials are unavailable, if any
 */

export {};

const scriptPath = Deno.env.get("SCRIPT_PATH");
const appId = Deno.env.get("BASE44_APP_ID");
const localUrl = Deno.env.get("BASE44_LOCAL_URL");
const localServiceToken = Deno.env.get("BASE44_LOCAL_SERVICE_TOKEN");
const remoteAccessToken = Deno.env.get("BASE44_ACCESS_TOKEN");
const remoteAppBaseUrl = Deno.env.get("BASE44_APP_BASE_URL");
const remoteError = Deno.env.get("BASE44_REMOTE_ERROR");

if (!scriptPath) {
  console.error("SCRIPT_PATH environment variable is required");
  Deno.exit(1);
}

if (!appId || !localUrl || !localServiceToken) {
  console.error(
    "BASE44_APP_ID, BASE44_LOCAL_URL, and BASE44_LOCAL_SERVICE_TOKEN are required",
  );
  Deno.exit(1);
}

import { createClient } from "npm:@base44/sdk";

const base44 = createClient({
  appId,
  serverUrl: localUrl,
  token: localServiceToken,
});

// Track every client created so we can clean them all up (clears analytics
// heartbeat intervals, disconnects sockets) and let the process exit.
const clients: { cleanup: () => void }[] = [base44];

interface RemoteOptions {
  dataEnv?: "prod" | "dev";
}

function remote(options?: RemoteOptions) {
  const dataEnv = options?.dataEnv ?? "prod";
  if (dataEnv !== "prod" && dataEnv !== "dev") {
    throw new Error(`Invalid dataEnv "${dataEnv}": expected "prod" or "dev"`);
  }
  if (!remoteAccessToken || !remoteAppBaseUrl) {
    throw new Error(
      `Remote app credentials are unavailable${remoteError ? `: ${remoteError}` : ""}`,
    );
  }
  const client = createClient({
    appId,
    serverUrl: remoteAppBaseUrl,
    token: remoteAccessToken,
    ...(dataEnv === "dev" ? { headers: { "X-Data-Env": "dev" } } : {}),
  });
  clients.push(client);
  return client;
}

const ctx = {
  base44,
  remote,
  log: (message: unknown) => console.error(message),
};

try {
  const module = await import(scriptPath);
  const seed = module?.default;
  if (typeof seed !== "function") {
    console.error(
      "Seed script must have a default export function: export default async function seed(ctx) { ... }",
    );
    Deno.exit(1);
  }
  await seed(ctx);
} catch (error) {
  console.error("Seed script failed:", error);
  Deno.exit(1);
} finally {
  for (const client of clients) {
    client.cleanup();
  }
}
