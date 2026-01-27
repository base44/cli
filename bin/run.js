#!/usr/bin/env node
import { program, CLIExitError, errorReporter } from "../dist/index.js";

// Disable Clack spinners and animations in non-interactive environments.
// Clack only checks the CI env var, so we set it when stdin/stdout aren't TTYs.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.env.CI = "true";
}

// Initialize error reporter
// The API key should be provided via environment variable
const posthogApiKey = process.env.POSTHOG_API_KEY;
if (posthogApiKey) {
  errorReporter.initialize(posthogApiKey, process.env.POSTHOG_HOST);
}

try {
  await program.parseAsync();
} catch (error) {
  // Report the error to PostHog if it's not a controlled exit
  if (!(error instanceof CLIExitError)) {
    await errorReporter.captureException(error, {
      command: process.argv.slice(2).join(" "),
      node_version: process.version,
      platform: process.platform,
    });
  }

  // Ensure PostHog events are sent before exiting
  await errorReporter.shutdown();

  if (error instanceof CLIExitError) {
    process.exit(error.code);
  }
  console.error(error);
  process.exit(1);
} finally {
  // Always shutdown error reporter on normal exit too
  await errorReporter.shutdown();
}
