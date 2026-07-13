import { pathExists, readJsonFile, writeJsonFile } from "@/core/utils/fs.js";
import { getMetaJsonPath } from "./paths.js";
import { type DataDirMeta, DataDirMetaSchema } from "./schema.js";

export type MetaReadResult =
  | { status: "ok"; meta: DataDirMeta }
  | { status: "missing" }
  | { status: "corrupt" };

/**
 * Read `<dataDir>/meta.json`. Corrupt (unreadable or schema-invalid) meta is
 * reported rather than thrown — callers warn and treat the data dir as new.
 */
export async function readDataDirMeta(
  dataDir: string,
): Promise<MetaReadResult> {
  const metaPath = getMetaJsonPath(dataDir);
  if (!(await pathExists(metaPath))) {
    return { status: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = await readJsonFile(metaPath);
  } catch {
    return { status: "corrupt" };
  }

  const result = DataDirMetaSchema.safeParse(parsed);
  return result.success
    ? { status: "ok", meta: result.data }
    : { status: "corrupt" };
}

export async function writeDataDirMeta(
  dataDir: string,
  meta: DataDirMeta,
): Promise<void> {
  await writeJsonFile(getMetaJsonPath(dataDir), meta);
}
