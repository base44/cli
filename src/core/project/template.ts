import { dirname, join } from "node:path";
import { globby } from "globby";
import ejs from "ejs";
import { getTemplatesDir, getTemplatesIndexPath } from "../config.js";
import { readJsonFile, readFile, writeFile, copyFile } from "../utils/fs.js";
import { TemplatesConfigSchema } from "./schema.js";
import type { Template } from "./schema.js";

export interface TemplateData {
  name: string;
  description?: string;
  projectId: string;
}

interface TemplateFrontmatter {
  outputPath?: string;
}

/**
 * Parse YAML-like frontmatter from a template file.
 * Frontmatter is delimited by --- at the start of the file.
 *
 * @example
 * ---
 * outputPath: .env.local
 * ---
 * REST_OF_CONTENT
 */
function parseFrontmatter(content: string): {
  frontmatter: TemplateFrontmatter;
  body: string;
} {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, frontmatterStr, body] = match;
  const frontmatter: TemplateFrontmatter = {};

  // Parse simple key: value pairs
  for (const line of frontmatterStr.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key === "outputPath") {
        frontmatter.outputPath = value;
      }
    }
  }

  return { frontmatter, body };
}

export async function listTemplates(): Promise<Template[]> {
  const parsed = await readJsonFile(getTemplatesIndexPath());
  const result = TemplatesConfigSchema.parse(parsed);
  return result.templates;
}

/**
 * Render a template directory to a destination path.
 * - Files ending in .ejs are rendered with EJS and written without the .ejs extension
 * - EJS files can have frontmatter with `outputPath` to specify a custom output filename
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
        // Read the file content to check for frontmatter
        const contentBuffer = await readFile(srcPath);
        const content = contentBuffer.toString("utf-8");
        const { frontmatter, body } = parseFrontmatter(content);

        // Determine output path: use frontmatter.outputPath or default to removing .ejs
        let destFile: string;
        if (frontmatter.outputPath) {
          // Replace the filename with the frontmatter outputPath, keeping the directory
          const dir = dirname(file);
          destFile = dir === "." ? frontmatter.outputPath : join(dir, frontmatter.outputPath);
        } else {
          destFile = file.replace(/\.ejs$/, "");
        }

        const destFilePath = join(destPath, destFile);
        const rendered = await ejs.render(body, data, { filename: srcPath });
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
