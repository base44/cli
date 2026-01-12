import { z } from "zod";

// Template schemas
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

// App config schemas
const SiteConfigSchema = z.object({
  buildCommand: z.string().optional(),
  serveCommand: z.string().optional(),
  outputDirectory: z.string().optional(),
  installCommand: z.string().optional(),
});

export const AppConfigSchema = z.object({
  name: z.string().min(1, "App name cannot be empty"),
  description: z.string().optional(),
  site: SiteConfigSchema.optional(),
  domains: z.array(z.string()).optional(),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const CreateProjectResponseSchema = z.looseObject({
  id: z.string(),
});

export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;
