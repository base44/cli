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
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const CreateProjectResponseSchema = z.looseObject({
  id: z.string(),
});

export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;
