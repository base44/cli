import type { RunLiveHandle } from "./CLITestkit";

export const waitForDevServer = async (
  runLiveHandle: RunLiveHandle,
): Promise<string> => {
  const pattern = /Dev server is available at (http\S+)/;
  await runLiveHandle.waitForOutput(pattern);
  const match = runLiveHandle.stdout.join("").match(pattern);
  if (!match) {
    throw new Error(`Can't find dev server url`);
  }
  return match[1];
};
