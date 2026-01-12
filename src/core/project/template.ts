import { join, isAbsolute } from "node:path";
import { globby } from "globby";
import ejs from "ejs";
import { getTemplatesDir } from "../config.js";
import { readJsonFile, writeFile, copyFile } from "../utils/fs.js";
import { TemplatesConfigSchema } from "./schema.js";
import type { Template } from "./schema.js";

export interface TemplateData {
  name: string;
  description?: string;
  projectId: string;
}

export async function listTemplates(): Promise<Template[]> {
  const configPath = join(getTemplatesDir(), "templates.json");
  const parsed = await readJsonFile(configPath);
  const result = TemplatesConfigSchema.parse(parsed);
  return result.templates;
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
  // Validate template path to prevent directory traversal
  if (template.path.includes("..") || isAbsolute(template.path)) {
    throw new Error(`Invalid template path: ${template.path}`);
  }

  const templateDir = join(getTemplatesDir(), template.path);

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
