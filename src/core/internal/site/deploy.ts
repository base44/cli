import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KyInstance } from "ky";
import { create as tarCreate } from "tar";
import {
  ConfigInvalidError,
  FileNotFoundError,
} from "@/core/internal/errors.js";
import { uploadSite } from "@/core/internal/site/api.js";
import { getSiteFilePaths } from "@/core/internal/site/config.js";
import type { DeployResponse } from "@/core/internal/site/schema.js";
import { deleteFile, pathExists } from "@/core/internal/utils/fs.js";

export async function deploySite(
  siteOutputDir: string,
  client?: KyInstance
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
      siteOutputDir,
      {
        hints: [
          { message: "Run your build command (e.g., 'npm run build') first" },
        ],
      }
    );
  }

  // Create a temporary file for the archive
  const archivePath = join(tmpdir(), `base44-site-${randomUUID()}.tar.gz`);

  try {
    await createArchive(siteOutputDir, archivePath);
    return await uploadSite(archivePath, client);
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
