import { resolveHttpPrivateDataSourceUrl } from "./http-url";
import {
  currentPrivateDataSource,
  privateDataSourceBinding,
} from "./manifest";
import type { FetchPrivateDataSourceBinding, PrivateDataSourceManifestEntry } from "./types";

// Internal, NOT a public virtual module: app code cannot import this builder to
// hand-forge a manifest entry. The only public entrypoints — http()/elasticsearch()
// — resolve their entry from the immutable runtime manifest via lookupPrivateDataSource.

function hasFetch(binding: unknown): binding is FetchPrivateDataSourceBinding {
  return (
    binding !== null &&
    typeof binding === "object" &&
    typeof (binding as { fetch?: unknown }).fetch === "function"
  );
}

export function buildHttpPrivateDataSource(entry: PrivateDataSourceManifestEntry) {
  return Object.freeze({
    name: entry.name,
    type: entry.type,
    get bindingName() {
      return currentPrivateDataSource(entry).bindingName;
    },
    fetch(resource: RequestInfo | URL, init?: RequestInit) {
      const current = currentPrivateDataSource(entry);
      const binding = privateDataSourceBinding(current);
      if (!hasFetch(binding)) {
        throw new Error(
          `Private data source "${current.name}" does not expose fetch()`,
        );
      }
      return binding.fetch(
        resolveHttpPrivateDataSourceUrl(current, resource),
        init,
      );
    },
    // Fixed services expose the raw binding (Cloudflare pins their single
    // target). Deferred Actor handles decide this from the request manifest,
    // after their request environment exists.
    get binding() {
      const current = currentPrivateDataSource(entry);
      return current.bindingName !== undefined
        && current.networkScope !== "network"
        ? privateDataSourceBinding(current)
        : undefined;
    },
  });
}
