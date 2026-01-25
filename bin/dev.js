#!/usr/bin/env tsx
import { program, CLIExitError } from "../src/cli/index.ts";

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CLIExitError) {
    process.exit(error.code);
  }
  console.error(error);
  process.exit(1);
}
