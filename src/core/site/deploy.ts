import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { create as tarCreate } from "tar";
import type { DeployResponse } from "@/core/site/schema.js";
import { getSiteFilePaths } from "@/core/site/config.js";
import { uploadSite } from "@/core/site/api.js";
import { pathExists, deleteFile } from "@/core/utils/fs.js";
import { FileNotFoundError, ConfigInvalidError } from "@/core/errors.js";

export async function deploySite(
  siteOutputDir: string
): Promise<DeployResponse> {
  if (!(await pathExists(siteOutputDir))) {
    throw new FileNotFoundError(
      `Output directory does not exist: ${siteOutputDir}. Make sure to build your project first.`,
      {
        hints: [
          { message: "Run your build command (e.g., 'npm run build') first" },
        ],
      }
    );
  }

  const filePaths = await getSiteFilePaths(siteOutputDir);
  if (filePaths.length === 0) {
    throw new ConfigInvalidError(
      `No files found in output directory: ${siteOutputDir}. Make sure to build your project first.`,
      {
        hints: [
          { message: "Run your build command (e.g., 'npm run build') first" },
        ],
      }
    );
  }

  // Create a temporary file for the archive
  const archivePath = join(
    tmpdir(),
    `base44-site-${randomUUID()}.tar.gz`
  );

  try {
    await createArchive(siteOutputDir, archivePath);
    return await uploadSite(archivePath);
  } finally {
    await deleteFile(archivePath);
  }
}

async function createArchive(
  pathToArchive: string,
  targetArchivePath: string
): Promise<void> {
  await tarCreate(
    {
      gzip: true,
      file: targetArchivePath,
      cwd: pathToArchive,
    },
    ["."]
  );
}
