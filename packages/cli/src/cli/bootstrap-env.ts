import { loadProjectEnvFiles } from "@/core/utils/env.js";

// Side-effect module: loads project-local .env / .env.local into process.env at
// the very start of the CLI process. This MUST run before any module that reads
// env-derived config at import time — notably the HTTP clients, which capture
// the API base URL (getBase44ApiUrl) when ky.create() runs at module load.
//
// Imported first in cli/index.ts so it initializes ahead of the program graph.
loadProjectEnvFiles();
