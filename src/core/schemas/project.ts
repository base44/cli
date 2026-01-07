import { z } from "zod";

export const ProjectConfigSchema = z.looseObject({
  name: z.string().min(1, "Project name cannot be empty"),
  entitySrc: z.string().default("./entities"),
  functionSrc: z.string().default("./functions"),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export interface ProjectWithPaths extends ProjectConfig {
  root: string;
  configPath: string;
}


