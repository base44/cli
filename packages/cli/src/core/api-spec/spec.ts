import { stat } from "node:fs/promises";
import { join } from "node:path";
import { base44Client } from "@/core/clients/index.js";
import { getBase44ApiUrl, getBase44GlobalDir } from "@/core/config.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { readTextFile, writeFile } from "@/core/utils/fs.js";
import { type OpenApiSpec, OpenApiSpecSchema } from "./schema.js";

export const SPEC_CACHE_TTL_MS = 60 * 60 * 1000;

export interface LoadedSpec {
  text: string;
  spec: OpenApiSpec;
}

/** One cache file per server, e.g. ~/.base44/cache/app.base44.com/openapi.json. */
export function getSpecCachePath(apiUrl = getBase44ApiUrl()): string {
  const server = new URL(apiUrl).host.replace(/[^a-zA-Z0-9.-]/g, "_");
  return join(getBase44GlobalDir(), "cache", server, "openapi.json");
}

export function isSpecCacheFresh(mtimeMs: number, now = Date.now()): boolean {
  return now - mtimeMs < SPEC_CACHE_TTL_MS;
}

export function parseSpec(text: string): OpenApiSpec {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError("The API spec from the server is not valid JSON");
  }
  const result = OpenApiSpecSchema.safeParse(json);
  if (!result.success) {
    throw new SchemaValidationError("Invalid API spec", result.error);
  }
  return result.data;
}

async function readFreshCache(path: string): Promise<string | null> {
  try {
    const { mtimeMs } = await stat(path);
    return isSpecCacheFresh(mtimeMs) ? await readTextFile(path) : null;
  } catch {
    return null;
  }
}

async function downloadSpec(): Promise<string> {
  try {
    const response = await base44Client.get("api/openapi.json");
    return await response.text();
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching the API spec");
  }
}

/** The server's OpenAPI spec, from a cache under an hour old or the server. */
export async function loadSpec(
  options: { refresh?: boolean } = {},
): Promise<LoadedSpec> {
  const path = getSpecCachePath();
  const cached = options.refresh ? null : await readFreshCache(path);
  if (cached !== null) {
    return { text: cached, spec: parseSpec(cached) };
  }
  const text = await downloadSpec();
  const spec = parseSpec(text);
  await writeFile(path, text);
  return { text, spec };
}
