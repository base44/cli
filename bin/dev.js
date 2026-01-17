#!/usr/bin/env tsx
import { execute } from "@oclif/core";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await execute({
  development: true,
  dir: resolve(__dirname, ".."),
});
