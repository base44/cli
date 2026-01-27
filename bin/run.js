#!/usr/bin/env node

// Detect non-interactive environment and disable animations
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
