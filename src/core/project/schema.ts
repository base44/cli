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
  name: z.string().min(1, "App name cannot be empty"),
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

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  userDescription: z.string().optional(),
  isManagedSourceCode: z.boolean().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectsResponseSchema = z.array(ProjectSchema);

export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;
