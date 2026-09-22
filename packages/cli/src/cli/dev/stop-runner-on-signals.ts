import process from "node:process";
import type { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";

/** Tear the dev server down on Ctrl-C and on a terminating signal. */
export function stopRunnerOnProcessSignals(runner: ServeRunner): void {
  const stop = () => void runner.stop();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
