import { loadProjectEnvFiles, loadSavedLoginApiUrl } from "@/core/utils/env.js";

// `login --hostname` is read from argv, not commander: the HTTP clients capture
// the URL at import. Only after `login`, so a `--hostname` passed through to
// another program (`base44 site dev -- --hostname 0.0.0.0`) is left alone.
function applyLoginHostnameFlag(argv: string[]): void {
  const args = argv.slice(2);
  const login = args.indexOf("login");
  const i = args.findIndex(
    (arg) => arg === "--hostname" || arg.startsWith("--hostname="),
  );
  if (login === -1 || i < login) {
    return;
  }
  const value = args[i].includes("=")
    ? args[i].slice("--hostname=".length)
    : args[i + 1];
  if (!value || value.startsWith("-")) {
    return; // commander reports the missing argument
  }
  const url = value.includes("://") ? value : `https://${value}`;
  process.env.BASE44_API_URL = url.replace(/\/+$/, "");
}

// Must run before any module reads env-derived config at import time — notably
// the HTTP clients, which capture getBase44ApiUrl() when ky.create() runs at
// module load. Imported first in cli/index.ts so it initializes ahead of them.
// Precedence: `login --hostname` > environment > `.env` files > the saved
// login's host.
applyLoginHostnameFlag(process.argv);
loadProjectEnvFiles();
loadSavedLoginApiUrl();
