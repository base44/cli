import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

// After bundling, import.meta.url points to dist/cli/index.js
// Templates are copied to dist/cli/templates/
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "templates");

const CONFIG_TEMPLATE_PATH = join(TEMPLATES_DIR, "config.jsonc.ejs");
const ENV_TEMPLATE_PATH = join(TEMPLATES_DIR, "env.local.ejs");

interface ConfigTemplateData {
  name: string;
  description?: string;
}

interface EnvTemplateData {
  projectId: string;
}

export async function renderConfigTemplate(
  data: ConfigTemplateData
): Promise<string> {
  return ejs.renderFile(CONFIG_TEMPLATE_PATH, data);
}

export async function renderEnvTemplate(data: EnvTemplateData): Promise<string> {
  return ejs.renderFile(ENV_TEMPLATE_PATH, data);
}
