import { join } from "node:path";
import { globby } from "globby";
import ejs from "ejs";
import { getTemplatesDir, getTemplatesIndexPath } from "../config.js";
import { readJsonFile, writeFile, copyFile, pathExists } from "../utils/fs.js";
import { TemplatesConfigSchema } from "./schema.js";
import type { Template } from "./schema.js";
import { listRemoteTemplates, getRemoteTemplateDir } from "./remote.js";

export interface TemplateData {
  name: string;
  description?: string;
  projectId: string;
}

/**
 * List all available templates.
 * Combines bundled templates with remote templates from base44/apps-examples.
 */
export async function listTemplates(): Promise<Template[]> {
  const templates: Template[] = [];

  // First, try to load bundled templates (fallback for offline use)
  try {
    const bundledIndexPath = getTemplatesIndexPath();
    if (await pathExists(bundledIndexPath)) {
      const parsed = await readJsonFile(bundledIndexPath);
      const result = TemplatesConfigSchema.parse(parsed);
      templates.push(...result.templates.map((t) => ({ ...t, source: "bundled" as const })));
    }
  } catch {
    // Bundled templates not available
  }

  // Then, try to fetch remote templates
  try {
    const remoteTemplates = await listRemoteTemplates();
    // Mark remote templates and add them (avoiding duplicates by id)
    const bundledIds = new Set(templates.map((t) => t.id));
    for (const t of remoteTemplates) {
      if (!bundledIds.has(t.id)) {
        templates.push({ ...t, source: "remote" as const });
      }
    }
  } catch {
    // Remote templates not available (offline mode)
  }

  if (templates.length === 0) {
    throw new Error(
      "No templates available. Please check your internet connection or try again later."
    );
  }

  return templates;
}

/**
 * Get the directory path for a template, handling both bundled and remote templates.
 */
async function getTemplateDirectory(template: Template): Promise<string> {
  // Check if it's a remote template
  if ((template as Template & { source?: string }).source === "remote") {
    return await getRemoteTemplateDir(template);
  }

  // Default to bundled templates
  const bundledPath = join(getTemplatesDir(), template.path);
  if (await pathExists(bundledPath)) {
    return bundledPath;
  }

  // If bundled path doesn't exist, try remote
  return await getRemoteTemplateDir(template);
}

/**
 * Render a template directory to a destination path.
 * - Files ending in .ejs are rendered with EJS and written without the .ejs extension
 * - All other files are copied directly
 */
export async function renderTemplate(
  template: Template,
  destPath: string,
  data: TemplateData
): Promise<void> {
  const templateDir = await getTemplateDirectory(template);

  // Get all files in the template directory
  const files = await globby("**/*", {
    cwd: templateDir,
    dot: true,
    onlyFiles: true,
  });

  for (const file of files) {
    const srcPath = join(templateDir, file);

    try {
      if (file.endsWith(".ejs")) {
        // Render EJS template and write without .ejs extension
        const destFile = file.replace(/\.ejs$/, "");
        const destFilePath = join(destPath, destFile);
        const rendered = await ejs.renderFile(srcPath, data);
        await writeFile(destFilePath, rendered);
      } else {
        // Copy file directly
        const destFilePath = join(destPath, file);
        await copyFile(srcPath, destFilePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to process template file "${file}": ${message}`);
    }
  }
}
