#!/usr/bin/env node

// Disable Clack spinners and animations in non-interactive environments.
// Clack only checks the CI env var, so we set it when stdin/stdout aren't TTYs.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.env.CI = 'true';
}

import { program, CLIExitError } from "../dist/index.js";

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CLIExitError) {
    process.exit(error.code);
  }
  console.error(error);
  process.exit(1);
}
