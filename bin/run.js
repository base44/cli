#!/usr/bin/env node
import { CommanderError } from "commander";
import { program, CLIExitError, isJsonMode, outputJsonError } from "../dist/index.js";

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CLIExitError) {
    process.exit(error.code);
  }

  if (error instanceof CommanderError) {
    if (isJsonMode()) {
      outputJsonError(error.message, error.code);
    }
    // Non-JSON mode: Commander already output the error via configureOutput
    process.exit(error.exitCode);
  }

  // Handle all other errors
  if (isJsonMode()) {
    outputJsonError(error instanceof Error ? error : String(error));
    process.exit(1);
  }

  // Non-JSON mode: show clean error message
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
