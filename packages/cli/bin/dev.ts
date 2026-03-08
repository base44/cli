#!/usr/bin/env bun
import { runCLI } from "../src/cli/index.ts";

// Disable Clack spinners and animations in non-interactive environments.
// Clack only checks the CI env var, so we set it when stdin/stdout aren't TTYs.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.env.CI = "true";
}

await runCLI();
