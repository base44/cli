import { createHash } from "node:crypto";
import { hashFileInto } from "@/core/site/manifest.js";

/**
 * A full sha256 over a file's bytes, streamed so a large file is never read
 * whole. Deliberately not `hashAsset` — see {@link ArtifactFile.digest}.
 */
export async function digestFile(absolutePath: string): Promise<string> {
  const hash = await hashFileInto(createHash("sha256"), absolutePath);
  return `sha256:${hash.digest("hex")}`;
}
