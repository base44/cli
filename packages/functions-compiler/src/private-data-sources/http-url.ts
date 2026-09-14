import type { PrivateDataSourceManifestEntry } from "./types";

const FALLBACK_BASE_URL = "http://private-data-source.local";

/**
 * Resolve a fetch target for an HTTP private data source. Relative paths resolve
 * against the source's base URL; absolute URLs pass through. There is no host
 * allowlist: for a fixed VPC service Cloudflare pins the single target, and for a
 * network binding the reachable set is the customer's tunnel scope — the app can
 * fetch any host behind it (e.g. Trino router + cluster nextUri hosts).
 */
export function resolveHttpPrivateDataSourceUrl(
  entry: PrivateDataSourceManifestEntry,
  resource: RequestInfo | URL,
): RequestInfo | URL {
  if (resource instanceof Request) return resource;
  const raw = resource instanceof URL ? resource.toString() : String(resource);
  try {
    return new URL(raw).toString();
  } catch {
    return new URL(raw || "/", entry.baseUrl || FALLBACK_BASE_URL).toString();
  }
}
