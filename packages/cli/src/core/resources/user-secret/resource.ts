import type { Resource } from "../types.js";
import { pushUserSecrets } from "./api.js";
import { readAllUserSecrets } from "./config.js";
import type { UserSecretDefinition } from "./schema.js";

export const userSecretResource: Resource<UserSecretDefinition> = {
  readAll: readAllUserSecrets,
  push: pushUserSecrets,
};
