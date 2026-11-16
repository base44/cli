import { loadProjectEnvFiles } from "@/core/utils/env.js";

// Read from argv, not commander: the HTTP clients capture the URL at import.
function applyHostnameFlag(argv: string[]): void {
  const i = argv.findIndex(
    (arg) => arg === "--hostname" || arg.startsWith("--hostname="),
  );
  if (i === -1) {
    return;
  }
  const value = argv[i].includes("=")
    ? argv[i].slice("--hostname=".length)
    : argv[i + 1];
  if (!value || value.startsWith("-")) {
    return; // commander reports the missing argument
  }
  const url = value.includes("://") ? value : `https://${value}`;
  process.env.BASE44_API_URL = url.replace(/\/+$/, "");
}

// Must run before any module reads env-derived config at import time — notably
// the HTTP clients, which capture getBase44ApiUrl() when ky.create() runs at
// module load. Imported first in cli/index.ts so it initializes ahead of them.
// The flag is applied first so it wins over the environment and `.env` files.
applyHostnameFlag(process.argv);
loadProjectEnvFiles();
