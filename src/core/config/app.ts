import { z } from "zod";

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

