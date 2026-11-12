import { workerEnvironment } from "./private-data-sources/runtime-environment";
import { STATIC_EGRESS_ARTIFACT_MARKER } from "./static-egress-marker";

export { STATIC_EGRESS_ARTIFACT_MARKER };

const STATIC_EGRESS_BINDING_NAME = "STATIC_EGRESS";
const PRIVATE_DATA_SOURCES_MANIFEST_ENV = "BASE44_PRIVATE_DATA_SOURCES";
const STATIC_EGRESS_EXCLUDED_HOSTS_ENV = "BASE44_STATIC_EGRESS_EXCLUDED_HOSTS";
const STATIC_EGRESS_ENABLED_ENV = "BASE44_STATIC_EGRESS_ENABLED";

const STATIC_EGRESS_DIAGNOSTIC_LIMIT = 5;

interface FetchBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

let staticEgressFetchInstalled = false;
let staticEgressDiagnosticCount = 0;

type StaticEgressRoute = "dedicated" | "excluded" | "fallback";

function inputKind(input: RequestInfo | URL): "string" | "url" | "request" {
  if (typeof input === "string") return "string";
  return input instanceof URL ? "url" : "request";
}

function logStaticEgressDecision(
  route: StaticEgressRoute,
  input: RequestInfo | URL,
  binding: unknown,
  enableSecret: unknown,
): void {
  if (staticEgressDiagnosticCount >= STATIC_EGRESS_DIAGNOSTIC_LIMIT) return;
  staticEgressDiagnosticCount += 1;
  console.log(JSON.stringify({
    b44_diagnostic: "static_egress",
    diagnostic_version: STATIC_EGRESS_ARTIFACT_MARKER,
    event: "fetch_route",
    route,
    input_kind: inputKind(input),
    binding_present: binding !== undefined,
    binding_type: typeof binding,
    enable_secret_present: enableSecret !== undefined,
    enable_secret_enabled: isEnabled(enableSecret),
    binding_fetch_type:
      binding !== null && typeof binding === "object"
        ? typeof (binding as { fetch?: unknown }).fetch
        : "undefined",
  }));
}

function hasFetch(value: unknown): value is FetchBinding {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { fetch?: unknown }).fetch === "function"
  );
}

function isEnabled(value: unknown): boolean {
  return value === "1";
}

function privateDataSourceHosts(raw: unknown): Set<string> {
  if (typeof raw !== "string" || !raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.flatMap((entry) => {
        if (entry === null || typeof entry !== "object") return [];
        const host = (entry as { host?: unknown }).host;
        return typeof host === "string" && host
          ? [normalizeHostname(host)]
          : [];
      }),
    );
  } catch {
    return new Set();
  }
}

function configuredExcludedHosts(raw: unknown): Set<string> {
  if (typeof raw !== "string" || !raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.flatMap((host) =>
        typeof host === "string" && host ? [normalizeHostname(host)] : [],
      ),
    );
  } catch {
    return new Set();
  }
}

function normalizeHostname(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

function targetHostname(input: RequestInfo | URL): string | null {
  try {
    const raw =
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url;
    return normalizeHostname(new URL(raw).hostname);
  } catch {
    return null;
  }
}

function isExcludedHostname(
  hostname: string,
  excludedHosts: ReadonlySet<string>,
): boolean {
  for (const excludedHost of excludedHosts) {
    if (excludedHost.startsWith(".")) {
      const apex = excludedHost.slice(1);
      if (apex && (hostname === apex || hostname.endsWith(excludedHost))) {
        return true;
      }
    } else if (hostname === excludedHost) {
      return true;
    }
  }
  return false;
}

// stripe-node before its workerd build reports workerd's fixed process.version
// as lang_version, and Stripe then warns the account about an outdated Node.
const STRIPE_CLIENT_USER_AGENT_HEADER = "X-Stripe-Client-User-Agent";

function withoutLangVersion(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("lang_version" in parsed)
    ) {
      return null;
    }
    delete (parsed as Record<string, unknown>).lang_version;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

export function stripStripeLangVersion(
  input: RequestInfo | URL,
  init?: RequestInit,
): [RequestInfo | URL, RequestInit | undefined] {
  if (init?.headers !== undefined) {
    const headers = new Headers(init.headers);
    const value = withoutLangVersion(headers.get(STRIPE_CLIENT_USER_AGENT_HEADER));
    if (value === null) return [input, init];
    headers.set(STRIPE_CLIENT_USER_AGENT_HEADER, value);
    return [input, { ...init, headers }];
  }
  if (input instanceof Request) {
    const value = withoutLangVersion(input.headers.get(STRIPE_CLIENT_USER_AGENT_HEADER));
    if (value === null) return [input, init];
    const headers = new Headers(input.headers);
    headers.set(STRIPE_CLIENT_USER_AGENT_HEADER, value);
    return [new Request(input, { headers }), init];
  }
  return [input, init];
}

export function createRequestScopedStaticEgressFetch(
  originalFetch: typeof fetch,
  readEnvironment: () => Record<string, unknown>,
): typeof fetch {
  return (rawInput: RequestInfo | URL, rawInit?: RequestInit) => {
    const [input, init] = stripStripeLangVersion(rawInput, rawInit);
    const env = readEnvironment();
    const binding = env[STATIC_EGRESS_BINDING_NAME];
    const enableSecret = env[STATIC_EGRESS_ENABLED_ENV];
    if (!hasFetch(binding) || !isEnabled(enableSecret)) {
      if (
        binding !== undefined ||
        enableSecret !== undefined ||
        typeof env[STATIC_EGRESS_EXCLUDED_HOSTS_ENV] === "string"
      ) {
        logStaticEgressDecision("fallback", input, binding, enableSecret);
      }
      return originalFetch(input, init);
    }

    const excludedHosts = new Set([
      ...privateDataSourceHosts(env[PRIVATE_DATA_SOURCES_MANIFEST_ENV]),
      ...configuredExcludedHosts(env[STATIC_EGRESS_EXCLUDED_HOSTS_ENV]),
    ]);
    // A leading dot excludes both the apps-domain apex and its subdomains.
    // Per-request custom-domain Base44-Api-Url values cannot be represented by
    // the static workspace binding and continue through dedicated egress.
    const hostname = targetHostname(input);
    if (hostname !== null && isExcludedHostname(hostname, excludedHosts)) {
      logStaticEgressDecision("excluded", input, binding, enableSecret);
      return originalFetch(input, init);
    }
    logStaticEgressDecision("dedicated", input, binding, enableSecret);
    return binding.fetch(input, init);
  };
}

export function installStaticEgressFetch(): void {
  if (staticEgressFetchInstalled) return;

  globalThis.fetch = createRequestScopedStaticEgressFetch(
    globalThis.fetch.bind(globalThis),
    workerEnvironment,
  );
  staticEgressFetchInstalled = true;
}
