import { join } from "node:path";

/** Name of the gitignored per-project local state directory. */
export const STATE_DIR_NAME = ".base44";

const DATA_DIR_NAME = "data";
const DEV_JSON_FILE = "dev.json";
const META_JSON_FILE = "meta.json";

/** `<projectRoot>/.base44` — root of all local dev state for a project. */
export function getStateDir(projectRoot: string): string {
  return join(projectRoot, STATE_DIR_NAME);
}

/** `<projectRoot>/.base44/data` — file-backed NeDB collections + meta.json. */
export function getDataDir(projectRoot: string): string {
  return join(getStateDir(projectRoot), DATA_DIR_NAME);
}

/** `<projectRoot>/.base44/dev.json` — running dev-server instance descriptor. */
export function getDevJsonPath(projectRoot: string): string {
  return join(getStateDir(projectRoot), DEV_JSON_FILE);
}

/** `<dataDir>/meta.json` — data dir metadata (owning app id, seed state). */
export function getMetaJsonPath(dataDir: string): string {
  return join(dataDir, META_JSON_FILE);
}
