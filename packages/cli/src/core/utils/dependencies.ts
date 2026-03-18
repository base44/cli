import { spawnSync } from "node:child_process";
import { DependencyNotFoundError } from "@/core/errors.js";

export function verifyDenoInstalled(context: string): void {
  const result = spawnSync("deno", ["--version"]);
  if (result.error) {
    throw new DependencyNotFoundError(`Deno is required ${context}`, {
      hints: [
        {
          message:
            "Install Deno: https://docs.deno.com/runtime/getting_started/installation/",
        },
      ],
    });
  }
}
