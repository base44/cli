#!/usr/bin/env node
import { execute } from "@oclif/core";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await execute({
  dir: resolve(__dirname, ".."),
});
