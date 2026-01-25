#!/usr/bin/env node
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
