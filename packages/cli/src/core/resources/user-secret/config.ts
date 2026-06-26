import { basename } from "node:path";
import { globby } from "globby";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { InvalidInputError, SchemaValidationError } from "@/core/errors.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";
import {
  type UserSecretDefinition,
  UserSecretDefinitionSchema,
} from "./schema.js";

export async function readAllUserSecrets(
  dir: string,
): Promise<UserSecretDefinition[]> {
  if (!(await pathExists(dir))) return [];
  const files = await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: dir,
    absolute: true,
  });
  const definitions = await Promise.all(
    files.map(async (filePath) => {
      const result = UserSecretDefinitionSchema.safeParse(
        await readJsonFile(filePath),
      );
      if (!result.success)
        throw new SchemaValidationError(
          "Invalid user credential definition",
          result.error,
          filePath,
        );
      const fileName = basename(filePath).replace(/\.jsonc?$/, "");
      if (fileName !== result.data.name) {
        throw new InvalidInputError(
          `User credential name "${result.data.name}" must match filename "${fileName}"`,
          {
            hints: [{ message: `Rename ${filePath} or update its name field` }],
          },
        );
      }
      return result.data;
    }),
  );
  const names = new Set<string>();
  for (const definition of definitions) {
    if (names.has(definition.name))
      throw new InvalidInputError(
        `Duplicate user credential name "${definition.name}"`,
      );
    names.add(definition.name);
  }
  return definitions;
}
