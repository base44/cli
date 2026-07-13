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
const SiteConfigSchema = z.object({
  buildCommand: z.string().optional(),
  serveCommand: z.string().optional(),
  outputDirectory: z.string().optional(),
  installCommand: z.string().optional(),
});

const PluginMetadataSchema = z.object({
  namespace: z
    .string()
    .min(1, "Plugin namespace cannot be empty")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Plugin namespace can only contain letters, numbers, underscores, and dashes",
    ),
});

export const PluginReferenceSchema = z.object({
  source: z.string().min(1, "Plugin source cannot be empty"),
});

export type PluginReference = z.infer<typeof PluginReferenceSchema>;

export const VISIBILITY_LEVELS = ["public", "private", "workspace"] as const;
export type Visibility = (typeof VISIBILITY_LEVELS)[number];

export const ProjectConfigSchema = z.object({
  name: z
    .string({
      error: "App name cannot be empty",
    })
    .min(1, "App name cannot be empty"),
  description: z.string().optional(),
  visibility: z.enum(VISIBILITY_LEVELS).optional(),
  site: SiteConfigSchema.optional(),
  entitiesDir: z.string().optional().default("entities"),
  functionsDir: z.string().optional().default("functions"),
  agentsDir: z.string().optional().default("agents"),
  connectorsDir: z.string().optional().default("connectors"),
  authDir: z.string().optional().default("auth"),
  plugin: PluginMetadataSchema.optional(),
  plugins: z.array(PluginReferenceSchema).optional().default([]),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const AppConfigSchema = z.object({
  id: z.string().min(1, "id cannot be empty"),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const CreateProjectResponseSchema = z.looseObject({
  id: z.string(),
});

export const AppDetailSchema = z
  .looseObject({
    id: z.string(),
    name: z.string().optional(),
    organization_id: z.string().nullish(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    organizationId: data.organization_id ?? undefined,
  }));

export type AppDetail = z.infer<typeof AppDetailSchema>;

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
