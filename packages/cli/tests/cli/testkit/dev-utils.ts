import type { RunLiveHandle } from "./CLITestkit";

export const waitForDevServer = async (
  runLiveHandle: RunLiveHandle,
): Promise<string> => {
  const pattern = /Dev server is available at (http\S+)/;
  await runLiveHandle.waitForOutput(pattern);
  const match = runLiveHandle.stdout.join("").match(pattern)!;
  return match[1];
};
