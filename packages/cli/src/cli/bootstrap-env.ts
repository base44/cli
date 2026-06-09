import { loadProjectEnvFiles } from "@/core/utils/env.js";

// Must run before any module reads env-derived config at import time — notably
// the HTTP clients, which capture getBase44ApiUrl() when ky.create() runs at
// module load. Imported first in cli/index.ts so it initializes ahead of them.
loadProjectEnvFiles();
