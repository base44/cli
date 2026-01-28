import { initMixpanel } from "@/core/telemetry/index.js";

// Initialize telemetry client at startup
initMixpanel();

export { program } from "./program.js";
export { CLIExitError } from "./errors.js";
