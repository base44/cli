import { basename, join } from "node:path";
import { InvalidInputError } from "@/core/errors.js";
import { createProject } from "@/core/project/api.js";
import { setAppContext } from "@/core/project/app-config.js";
import { deploySite } from "@/core/site/deploy.js";
import { pathExists } from "@/core/utils/fs.js";

async function requireIndexHtml(siteDir: string) {
  if (!(await pathExists(join(siteDir, "index.html")))) {
    throw new InvalidInputError(
      `No index.html found in "${siteDir}" — a static site needs one at the folder root.`,
    );
  }
}

export async function dropSite(siteDir: string) {
  await requireIndexHtml(siteDir);
  const name = basename(siteDir);
  const { projectId } = await createProject(name, `Static site '${name}'`);
  setAppContext({ id: projectId });
  const { appUrl } = await deploySite(siteDir);
  return { appId: projectId, appUrl };
}
