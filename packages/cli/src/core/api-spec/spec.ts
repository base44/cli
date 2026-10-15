import { rename, rm, stat } from "node:fs/promises";
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

const SPEC_DOWNLOAD_TIMEOUT_MS = 60_000;

/** A fresh cached spec, or null when it is missing, stale or unreadable. */
async function readFreshCache(path: string): Promise<LoadedSpec | null> {
  try {
    const { mtimeMs } = await stat(path);
    if (!isSpecCacheFresh(mtimeMs)) {
      return null;
    }
    const text = await readTextFile(path);
    return { text, spec: parseSpec(text) };
  } catch {
    return null;
  }
}

async function downloadSpec(): Promise<string> {
  try {
    const response = await base44Client.get("api/openapi.json", {
      timeout: SPEC_DOWNLOAD_TIMEOUT_MS,
    });
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
    return cached;
  }
  const text = await downloadSpec();
  const spec = parseSpec(text);
  // Write then rename, so a concurrent run never reads a half-written file.
  // A cache that can't be written (full or read-only disk) only costs speed.
  const partial = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(partial, text);
    await rename(partial, path);
  } catch {
    await rm(partial, { force: true }).catch(() => undefined);
  }
  return { text, spec };
}
