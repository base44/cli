import { z } from "zod";

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  path: z.string(),
});

export const TemplatesConfigSchema = z.object({
  templates: z.array(TemplateSchema),
});

export type Template = z.infer<typeof TemplateSchema>;
export type TemplatesConfig = z.infer<typeof TemplatesConfigSchema>;

const SiteConfigSchema = z.object({
  buildCommand: z.string().optional(),
  serveCommand: z.string().optional(),
  outputDirectory: z.string().optional(),
  installCommand: z.string().optional(),
});

export const ProjectConfigSchema = z.object({
  name: z
    .string({
      error: "App name cannot be empty",
    })
    .min(1, "App name cannot be empty"),
  description: z.string().optional(),
  site: SiteConfigSchema.optional(),
  entitiesDir: z.string().optional().default("entities"),
  functionsDir: z.string().optional().default("functions"),
  agentsDir: z.string().optional().default("agents"),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const AppConfigSchema = z.object({
  id: z.string().min(1, "id cannot be empty"),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const CreateProjectResponseSchema = z.looseObject({
  id: z.string(),
});

export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;

export const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    user_description: z.string().optional().nullable(),
    is_managed_source_code: z.boolean().optional(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    userDescription: data.user_description,
    isManagedSourceCode: data.is_managed_source_code,
  }));

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectsResponseSchema = z.array(ProjectSchema);

export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;

export const TestOverridesSchema = z.object({
  appConfig: z
    .object({
      id: z.string(),
      projectRoot: z.string(),
    })
    .optional(),
  latestVersion: z.string().nullable().optional(),
});

export type TestOverrides = z.infer<typeof TestOverridesSchema>;
