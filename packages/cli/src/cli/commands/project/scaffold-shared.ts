import { join } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { execa } from "execa";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { getDashboardUrl, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { deploySite, pushEntities } from "@/core/index.js";
import type { Template } from "@/core/project/index.js";
import { listTemplates, readProjectConfig } from "@/core/project/index.js";

/** Default template used by `create`/`scaffold` when none is specified. */
export const DEFAULT_TEMPLATE_ID = "backend-only";

/**
 * Looks up a template by id, throwing a helpful error listing valid ids.
 * Shared by the `create` and `scaffold` commands.
 */
export async function getTemplateById(templateId: string): Promise<Template> {
  const templates = await listTemplates();
  const template = templates.find((t) => t.id === templateId);
  if (!template) {
    const validIds = templates.map((t) => t.id).join(", ");
    throw new InvalidInputError(`Template "${templateId}" not found.`, {
      hints: [{ message: `Use one of: ${validIds}` }],
    });
  }
  return template;
}

interface CompleteProjectSetupOptions {
  projectId: string;
  name: string;
  resolvedPath: string;
  deploy?: boolean;
  skills?: boolean;
  isInteractive: boolean;
}

/**
 * Post-scaffold steps shared by `create` and `scaffold`: optionally push the
 * template's data models, optionally build & deploy the site, install AI agent
 * skills, then print the project/dashboard/site summary.
 *
 * Assumes the project files already exist and app config has been set
 * (via `setAppConfig`) so `getAppClient()` and `getDashboardUrl()` work.
 */
export async function completeProjectSetup(
  {
    projectId,
    name,
    resolvedPath,
    deploy,
    skills,
    isInteractive,
  }: CompleteProjectSetupOptions,
  { log, runTask }: Pick<CLIContext, "log" | "runTask">,
): Promise<RunCommandResult> {
  const { project, entities } = await readProjectConfig(resolvedPath);
  let finalAppUrl: string | undefined;

  if (entities.length > 0) {
    let shouldPushEntities: boolean;

    if (isInteractive) {
      const result = await confirm({
        message:
          "Set up the backend data now? (This pushes the data models used by the template to Base44)",
      });
      shouldPushEntities = !isCancel(result) && result;
    } else {
      shouldPushEntities = !!deploy;
    }

    if (shouldPushEntities) {
      await runTask(
        `Pushing ${entities.length} data models to Base44...`,
        async () => {
          await pushEntities(entities);
        },
        {
          successMessage: theme.colors.base44Orange(
            "Data models pushed successfully",
          ),
          errorMessage: "Failed to push data models",
        },
      );
    }
  }

  if (project.site) {
    const { installCommand, buildCommand, outputDirectory } = project.site;

    let shouldDeploy: boolean;

    if (isInteractive) {
      const result = await confirm({
        message: "Would you like to deploy the site now? (Hosted on Base44)",
      });
      shouldDeploy = !isCancel(result) && result;
    } else {
      shouldDeploy = !!deploy;
    }

    if (shouldDeploy && installCommand && buildCommand && outputDirectory) {
      const { appUrl } = await runTask(
        "Installing dependencies...",
        async (updateMessage) => {
          await execa({ cwd: resolvedPath, shell: true })`${installCommand}`;

          updateMessage("Building project...");
          await execa({ cwd: resolvedPath, shell: true })`${buildCommand}`;

          updateMessage("Deploying site...");
          return await deploySite(join(resolvedPath, outputDirectory));
        },
        {
          successMessage: theme.colors.base44Orange(
            "Site deployed successfully",
          ),
          errorMessage: "Failed to deploy site",
        },
      );

      finalAppUrl = appUrl;
    }
  }

  // Add AI agent skills (--no-skills flag sets skills to false, otherwise defaults to true)
  if (skills) {
    try {
      await runTask(
        "Installing AI agent skills...",
        async () => {
          await execa("npx", ["-y", "skills", "add", "base44/skills", "-y"], {
            cwd: resolvedPath,
            shell: true,
          });
        },
        {
          successMessage: theme.colors.base44Orange(
            "AI agent skills added successfully",
          ),
          errorMessage:
            "Failed to add AI agent skills - you can add them later with: npx skills add base44/skills",
        },
      );
    } catch {
      // Skills installation is non-critical (e.g., user may not have git installed)
      // The error message is already shown by runTask, so we just continue
    }
  }

  log.message(
    `${theme.styles.header("Project")}: ${theme.colors.base44Orange(name)}`,
  );
  log.message(
    `${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(projectId))}`,
  );

  if (finalAppUrl) {
    log.message(
      `${theme.styles.header("Site")}: ${theme.colors.links(finalAppUrl)}`,
    );
  }

  return { outroMessage: "Your project is set up and ready to use" };
}
