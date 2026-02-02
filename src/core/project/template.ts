import { join, dirname } from "node:path";
import { globby } from "globby";
import ejs from "ejs";
import frontmatter from 'front-matter';
import { getTemplatesDir, getTemplatesIndexPath } from "@/core/config.js";
import { readJsonFile, writeFile, copyFile } from "@/core/utils/fs.js";
import { TemplatesConfigSchema } from "@/core/project/schema.js";
import type { Template } from "@/core/project/schema.js";
import { SchemaValidationError } from "@/core/errors.js";

export interface TemplateData {
  name: string;
  description?: string;
  projectId: string;
}

interface TemplateFrontmatter {
  outputFileName?: string;
}

export async function listTemplates(): Promise<Template[]> {
  const parsed = await readJsonFile(getTemplatesIndexPath());
  const result = TemplatesConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError("Invalid templates configuration", result.error, getTemplatesIndexPath());
  }

  return result.data.templates;
}

/**
 * Render a template directory to a destination path.
 * - Files ending in .ejs are rendered with EJS and written without the .ejs extension
 * - EJS files can have frontmatter with custom attributes
 * - All other files are copied directly
 */
export async function renderTemplate(
  template: Template,
  destPath: string,
  data: TemplateData
): Promise<void> {
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
        // Render EJS template and write to outputFileName or filename without .ejs extension
        const rendered = await ejs.renderFile(srcPath, data);
        const { attributes, body } = frontmatter<TemplateFrontmatter>(rendered);
        const destFile = attributes.outputFileName ? join(dirname(file), attributes.outputFileName) : file.replace(/\.ejs$/, "");
        const destFilePath = join(destPath, destFile);

        await writeFile(destFilePath, body);
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
