import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { extract } from "tar";
import {
  TEMPLATES_REPO_OWNER,
  TEMPLATES_REPO_NAME,
  TEMPLATES_BRANCH,
  getRemoteTemplatesCacheDir,
  getRemoteTemplatesIndexPath,
} from "../config.js";
import { pathExists, writeJsonFile, readJsonFile } from "../utils/fs.js";
import { TemplatesConfigSchema } from "./schema.js";
import type { Template } from "./schema.js";

const GITHUB_API_BASE = "https://api.github.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheMetadata {
  lastUpdated: number;
  templates: Template[];
}

/**
 * Fetch the list of templates from the remote repository.
 * Uses a local cache with a 24-hour TTL.
 */
export async function listRemoteTemplates(): Promise<Template[]> {
  const cacheDir = getRemoteTemplatesCacheDir();
  const cacheIndexPath = getRemoteTemplatesIndexPath();

  // Check if cache exists and is fresh
  if (await pathExists(cacheIndexPath)) {
    try {
      const cached = (await readJsonFile(cacheIndexPath)) as CacheMetadata;
      if (Date.now() - cached.lastUpdated < CACHE_TTL_MS) {
        return cached.templates;
      }
    } catch {
      // Cache is corrupted, will refresh
    }
  }

  // Fetch fresh templates from GitHub
  const templates = await fetchTemplatesFromGitHub();

  // Create cache directory if it doesn't exist
  if (!(await pathExists(cacheDir))) {
    await mkdir(cacheDir, { recursive: true });
  }

  // Save to cache
  const cacheData: CacheMetadata = {
    lastUpdated: Date.now(),
    templates,
  };
  await writeJsonFile(cacheIndexPath, cacheData);

  return templates;
}

/**
 * Fetch templates list from GitHub repository.
 * First tries to fetch templates.json from the repo root.
 * Falls back to listing directories as templates.
 */
async function fetchTemplatesFromGitHub(): Promise<Template[]> {
  // Try to fetch templates.json from the repo
  const templatesJsonUrl = `https://raw.githubusercontent.com/${TEMPLATES_REPO_OWNER}/${TEMPLATES_REPO_NAME}/${TEMPLATES_BRANCH}/templates.json`;

  try {
    const response = await fetch(templatesJsonUrl);
    if (response.ok) {
      const data = await response.json();
      const result = TemplatesConfigSchema.parse(data);
      return result.templates;
    }
  } catch {
    // templates.json doesn't exist, fall back to listing directories
  }

  // Fall back: list directories in the repo as templates
  const apiUrl = `${GITHUB_API_BASE}/repos/${TEMPLATES_REPO_OWNER}/${TEMPLATES_REPO_NAME}/contents?ref=${TEMPLATES_BRANCH}`;
  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "base44-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch templates from GitHub: ${response.statusText}`);
  }

  const contents = (await response.json()) as Array<{
    name: string;
    type: string;
  }>;

  // Filter to directories only (excluding common non-template files)
  const excludeNames = ["node_modules", ".git", ".github", "templates.json", "README.md"];
  const directories = contents.filter(
    (item) => item.type === "dir" && !excludeNames.includes(item.name)
  );

  return directories.map((dir) => ({
    id: dir.name,
    name: dir.name,
    description: `Example project: ${dir.name}`,
    path: dir.name,
  }));
}

/**
 * Download and extract a template from the remote repository to the cache.
 */
export async function downloadRemoteTemplate(template: Template): Promise<string> {
  const cacheDir = getRemoteTemplatesCacheDir();
  const templateDir = join(cacheDir, template.path);

  // Check if template is already cached
  if (await pathExists(templateDir)) {
    return templateDir;
  }

  // Download the specific folder from the repo using GitHub's tarball API
  const tarballUrl = `https://api.github.com/repos/${TEMPLATES_REPO_OWNER}/${TEMPLATES_REPO_NAME}/tarball/${TEMPLATES_BRANCH}`;

  const response = await fetch(tarballUrl, {
    headers: {
      Accept: "application/vnd.github.v3.tarball",
      "User-Agent": "base44-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download template: ${response.statusText}`);
  }

  // Create cache directory if it doesn't exist
  if (!(await pathExists(cacheDir))) {
    await mkdir(cacheDir, { recursive: true });
  }

  // Extract the tarball
  const tempTarPath = join(cacheDir, `temp-${Date.now()}.tar.gz`);

  try {
    // Download tarball to temp file
    const fileStream = createWriteStream(tempTarPath);
    await pipeline(Readable.fromWeb(response.body as never), fileStream);

    // Extract the specific template folder
    await extractTemplateFolder(tempTarPath, cacheDir, template.path);

    return templateDir;
  } finally {
    // Clean up temp file
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tempTarPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract a specific folder from a GitHub tarball.
 * GitHub tarballs have a prefix like "owner-repo-sha/" that we need to handle.
 */
async function extractTemplateFolder(
  tarballPath: string,
  destDir: string,
  templatePath: string
): Promise<void> {
  // First, we need to find the prefix in the tarball
  // GitHub uses format: owner-repo-sha/
  let prefix = "";

  // Extract to get the prefix
  await extract({
    file: tarballPath,
    cwd: destDir,
    filter: (path) => {
      if (!prefix) {
        // First entry will give us the prefix
        const firstSlash = path.indexOf("/");
        if (firstSlash > 0) {
          prefix = path.substring(0, firstSlash + 1);
        }
      }
      // Only extract files from our template folder
      const relativePath = path.replace(prefix, "");
      return relativePath.startsWith(templatePath + "/") || relativePath === templatePath;
    },
    strip: 1, // Remove the prefix directory
  });
}

/**
 * Get the path to a cached remote template, downloading it if necessary.
 */
export async function getRemoteTemplateDir(template: Template): Promise<string> {
  const cacheDir = getRemoteTemplatesCacheDir();
  const templateDir = join(cacheDir, template.path);

  if (!(await pathExists(templateDir))) {
    await downloadRemoteTemplate(template);
  }

  return templateDir;
}
