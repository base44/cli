import { InvalidInputError } from "@/core/errors.js";
import { readTextFile } from "@/core/utils/fs.js";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

interface BodySource {
  stdinIsTTY: boolean;
  readStdin: () => Promise<string>;
}

/**
 * The request body from `--body '<json>'`, `--body @file.json`, `--body @-`,
 * or piped stdin. Piped stdin is read only for methods that carry a body.
 */
export async function resolveRequestBody(
  method: string,
  flag: string | undefined,
  source: BodySource,
): Promise<string | undefined> {
  const takesBody = !METHODS_WITHOUT_BODY.has(method.toUpperCase());
  if (flag !== undefined && !takesBody) {
    throw new InvalidInputError(
      `${method.toUpperCase()} requests cannot have a body.`,
    );
  }
  if (flag === "@-") {
    return source.readStdin();
  }
  if (flag?.startsWith("@")) {
    return readTextFile(flag.slice(1));
  }
  if (flag !== undefined) {
    return flag;
  }
  if (!takesBody || source.stdinIsTTY) {
    return undefined;
  }
  const piped = await source.readStdin();
  return piped.trim() ? piped : undefined;
}
