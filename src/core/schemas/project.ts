import { z } from "zod";

export const ProjectConfigSchema = z.looseObject({
  id: z.string().min(1, "Project ID cannot be empty"),
  name: z.string().min(1, "Project name cannot be empty"),
  createdAt: z.string(),
  entitySrc: z.string().default("./entities"),
  functionSrc: z.string().default("./functions"),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
