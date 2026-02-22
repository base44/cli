import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as tarCreate } from "tar";
import { ConfigInvalidError, FileNotFoundError } from "@/core/errors.js";
import { uploadSite } from "@/core/site/api.js";
import { getSiteFilePaths } from "@/core/site/config.js";
import type { DeployResponse } from "@/core/site/schema.js";
import { deleteFile, pathExists } from "@/core/utils/fs.js";

export async function deploySite(
  siteOutputDir: string,
): Promise<DeployResponse> {
  if (!(await pathExists(siteOutputDir))) {
    throw new FileNotFoundError(
      `Output directory does not exist: ${siteOutputDir}. Make sure to build your project first.`,
      {
        hints: [
          { message: "Run your build command (e.g., 'npm run build') first" },
        ],
      },
    );
  }

  const filePaths = await getSiteFilePaths(siteOutputDir);
  if (filePaths.length === 0) {
    throw new ConfigInvalidError(
      `No files found in output directory: ${siteOutputDir}. Make sure to build your project first.`,
      siteOutputDir,
      {
        hints: [
          { message: "Run your build command (e.g., 'npm run build') first" },
        ],
      },
    );
  }

  // Create a temporary file for the archive
  const archivePath = join(tmpdir(), `base44-site-${randomUUID()}.tar.gz`);

  try {
    await createArchive(siteOutputDir, archivePath);
    return await uploadSite(archivePath);
  } finally {
    await deleteFile(archivePath);
  }
}

async function createArchive(
  pathToArchive: string,
  targetArchivePath: string,
): Promise<void> {
  await tarCreate(
    {
      gzip: true,
      file: targetArchivePath,
      cwd: pathToArchive,
    },
    ["."],
  );
}
