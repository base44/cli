import { writeFile, pathExists } from "../utils/fs.js";
import { getProjectEnvPath } from "../config.js";

const ENV_LOCAL_TEMPLATE = `# Base44 Project Environment Variables
# This file contains environment-specific configuration for your Base44 project.
# Do not commit this file to version control if it contains sensitive data.

# Your Base44 Application ID
BASE44_CLIENT_ID={{projectId}}
`;

export function generateEnvLocalContent(projectId: string): string {
  return ENV_LOCAL_TEMPLATE.replace("{{projectId}}", projectId);
}

export async function writeEnvLocal(
  projectRoot: string,
  projectId: string
): Promise<string> {
  const envPath = getProjectEnvPath(projectRoot);
  const content = generateEnvLocalContent(projectId);
  await writeFile(envPath, content);
  return envPath;
}

export async function envLocalExists(projectRoot: string): Promise<boolean> {
  return pathExists(getProjectEnvPath(projectRoot));
}
