import {
  currentWorkerRuntimeContext,
  workerEnvironment,
} from "./runtime-environment";
import { getRuntimeManifest } from "./runtime-manifest-store";
import type { PrivateDataSourceManifestEntry } from "./types";

const PRIVATE_DATA_SOURCES_MANIFEST_ENV = "BASE44_PRIVATE_DATA_SOURCES";

function readStringVar(key: string): string | undefined {
  const value = workerEnvironment()[key];
  return typeof value === "string" ? value : undefined;
}

// Pin a HANDSHAKE-DELIVERED manifest to the deployed binding set: it is resolved
// fresh per activation, but the script's Hyperdrive/VPC bindings are frozen at
// upload — a source added/renamed since then must not surface an entry whose
// binding this script does not have (its lookup would pass and then fail deeper
// at privateDataSourceBinding). A manifest that exists as a Worker binding was
// frozen together with the live bindings, so it is served unfiltered.
function entryBindingIsDeployed(entry: PrivateDataSourceManifestEntry): boolean {
  return typeof entry.bindingName === "string" && workerEnvironment()[entry.bindingName] !== undefined;
}

function parsePrivateDataSourceManifest(): PrivateDataSourceManifestEntry[] {
  // Runtime-secrets bundles receive the manifest through the private, single-
  // instance store the activation shim writes (see runtime-manifest-store) — NOT
  // the Worker binding, process.env, or any user-reachable global. Old mode has
  // no runtime manifest and falls through to the immutable Worker binding.
  const runtimeRaw = getRuntimeManifest();
  const fromHandshake = runtimeRaw !== undefined;
  const raw = fromHandshake ? runtimeRaw : readStringVar(PRIVATE_DATA_SOURCES_MANIFEST_ENV);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed)
    ? parsed.filter(
        (entry): entry is PrivateDataSourceManifestEntry =>
          entry !== null && typeof entry === "object",
      )
    : [];
  return fromHandshake ? entries.filter(entryBindingIsDeployed) : entries;
}

export function normalizePrivateDataSourceKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function privateDataSourceReference(
  requestedName: unknown,
  expectedType: string,
): PrivateDataSourceManifestEntry {
  if (currentWorkerRuntimeContext()) {
    return lookupPrivateDataSource(requestedName, expectedType);
  }
  return {
    name: String(requestedName || ""),
    type: expectedType,
  };
}

function privateDataSourceMatchRank(
  entry: PrivateDataSourceManifestEntry,
  requestedName: unknown,
): number | null {
  const requested = String(requestedName || "");
  const normalizedRequested = normalizePrivateDataSourceKey(requested);
  const candidates = [
    { value: entry.name, rank: 0 },
    { value: entry.bindingName, rank: 1 },
    { value: entry.name, rank: 2, normalized: true },
    { value: entry.bindingName, rank: 3, normalized: true },
  ];
  let bestRank: number | null = null;
  for (const candidate of candidates) {
    if (typeof candidate.value !== "string") continue;
    const matches = candidate.normalized
      ? normalizePrivateDataSourceKey(candidate.value) === normalizedRequested
      : candidate.value === requested;
    if (matches && (bestRank === null || candidate.rank < bestRank)) {
      bestRank = candidate.rank;
    }
  }
  return bestRank;
}

function privateDataSourceMatchesExpectedType(
  entry: PrivateDataSourceManifestEntry,
  expectedType: string,
): boolean {
  return entry.type === expectedType || (expectedType === "hyperdrive" && entry.bindingKind === "hyperdrive");
}

export function lookupPrivateDataSource(
  requestedName: unknown,
  expectedType?: string,
): PrivateDataSourceManifestEntry {
  const matches = parsePrivateDataSourceManifest()
    .map((entry) => ({ entry, rank: privateDataSourceMatchRank(entry, requestedName) }))
    .filter((match): match is { entry: PrivateDataSourceManifestEntry; rank: number } => match.rank !== null)
    .sort((a, b) => a.rank - b.rank);
  if (matches.length === 0) {
    throw new Error(`Private data source "${requestedName}" is not bound to this backend function`);
  }

  const typeMatches = expectedType
    ? matches.filter((candidate) => privateDataSourceMatchesExpectedType(candidate.entry, expectedType))
    : matches;
  if (typeMatches.length === 0) {
    throw new Error(`Private data source "${requestedName}" is not a ${expectedType} data source`);
  }

  const bestRank = typeMatches[0].rank;
  const bestMatches = typeMatches.filter((candidate) => candidate.rank === bestRank);
  if (bestMatches.length > 1) {
    const kind = expectedType ? ` ${expectedType}` : "";
    throw new Error(
      `Private data source "${requestedName}" is ambiguous: ${bestMatches.length}${kind} data sources match this name`,
    );
  }
  return bestMatches[0].entry;
}

export function privateDataSourceBinding(entry: PrivateDataSourceManifestEntry): unknown {
  const current = lookupPrivateDataSource(entry.name, entry.type);
  if (!current.bindingName) {
    throw new Error(`Private data source "${current.name}" has no Worker binding name`);
  }
  const binding = workerEnvironment()[current.bindingName];
  if (!binding) {
    throw new Error(
      `Private data source binding "${current.bindingName}" is missing from the Worker environment`,
    );
  }
  return binding;
}

export function currentPrivateDataSource(
  entry: PrivateDataSourceManifestEntry,
): PrivateDataSourceManifestEntry {
  return lookupPrivateDataSource(entry.name, entry.type);
}
