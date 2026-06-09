import { dirname, join } from "node:path";
import ejs from "ejs";
import frontmatter from "front-matter";
import { globby } from "globby";
import { getTemplatesDir, getTemplatesIndexPath } from "@/core/assets.js";
import { SchemaValidationError } from "@/core/errors.js";
import type { Template } from "@/core/project/schema.js";
import { TemplatesConfigSchema } from "@/core/project/schema.js";
import {
  copyFile,
  pathExists,
  readJsonFile,
  writeFile,
} from "@/core/utils/fs.js";

interface TemplateData {
  name: string;
  description?: string;
  projectId: string;
}

interface TemplateFrontmatter {
  outputFileName?: string;
}

export async function listTemplates(): Promise<Template[]> {
  const indexPath = getTemplatesIndexPath();
  const parsed = await readJsonFile(indexPath);
  const result = TemplatesConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid templates configuration",
      result.error,
      indexPath,
    );
  }

  return result.data.templates;
}

interface RenderTemplateOptions {
  /**
   * Leave existing destination files untouched instead of overwriting — used
   * when scaffolding into a non-empty dir (must not clobber `.gitignore`).
   */
  skipExisting?: boolean;
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
  data: TemplateData,
  options: RenderTemplateOptions = {},
): Promise<string[]> {
  const { skipExisting = false } = options;
  const templateDir = join(getTemplatesDir(), template.path);

  // Get all files in the template directory
  const files = await globby("**/*", {
    cwd: templateDir,
    dot: true,
    onlyFiles: true,
  });

  const skipped: string[] = [];

  for (const file of files) {
    const srcPath = join(templateDir, file);

    try {
      if (file.endsWith(".ejs")) {
        // Render EJS template and write to outputFileName or filename without .ejs extension
        const rendered = await ejs.renderFile(srcPath, data);
        const { attributes, body } = frontmatter<TemplateFrontmatter>(rendered);
        const destFile = attributes.outputFileName
          ? join(dirname(file), attributes.outputFileName)
          : file.replace(/\.ejs$/, "");
        const destFilePath = join(destPath, destFile);

        if (skipExisting && (await pathExists(destFilePath))) {
          skipped.push(destFile);
          continue;
        }
        await writeFile(destFilePath, body);
      } else {
        // Copy file directly
        const destFilePath = join(destPath, file);

        if (skipExisting && (await pathExists(destFilePath))) {
          skipped.push(file);
          continue;
        }
        await copyFile(srcPath, destFilePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to process template file "${file}": ${message}`);
    }
  }

  return skipped;
}
