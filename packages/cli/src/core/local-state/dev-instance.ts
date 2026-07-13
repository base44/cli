import {
  deleteFile,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "@/core/utils/fs.js";
import { getDevJsonPath } from "./paths.js";
import { type DevInstance, DevInstanceSchema } from "./schema.js";

/** True when a process with the given pid is alive (EPERM counts as alive). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Write the instance descriptor for a running dev server. */
export async function writeDevInstance(
  projectRoot: string,
  instance: DevInstance,
): Promise<void> {
  await writeJsonFile(getDevJsonPath(projectRoot), instance);
}

/** Remove the instance descriptor (graceful dev-server shutdown). */
export async function deleteDevInstance(projectRoot: string): Promise<void> {
  await deleteFile(getDevJsonPath(projectRoot));
}

/**
 * Read the dev-server instance descriptor. Returns null when the file is
 * missing, invalid, or stale (owning process no longer alive); invalid and
 * stale files are deleted.
 */
export async function readDevInstance(
  projectRoot: string,
): Promise<DevInstance | null> {
  const devJsonPath = getDevJsonPath(projectRoot);
  if (!(await pathExists(devJsonPath))) {
    return null;
  }

  let instance: DevInstance | null = null;
  try {
    const result = DevInstanceSchema.safeParse(await readJsonFile(devJsonPath));
    instance = result.success ? result.data : null;
  } catch {
    instance = null;
  }

  if (!instance || !isPidAlive(instance.pid)) {
    await deleteFile(devJsonPath);
    return null;
  }
  return instance;
}
