import { workerEnvironment } from "./private-data-sources/runtime-environment";

const PLATFORM_FETCH_BINDING_NAME = "BASE44_PLATFORM_FETCH";

interface FetchBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

let platformFetchInstalled = false;

// User Workers run in a dispatch namespace that ignores their cache options, so
// for a default-cached extension (.bin, .png, .pdf...) the cache turns HEAD into
// GET and drops Range. The platform Worker behind the binding sends these as is.
function needsPlatformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean {
  try {
    const request =
      typeof input === "string" || input instanceof URL ? undefined : input;
    const method = String(init?.method ?? request?.method ?? "GET");
    // Like the Request constructor: init headers replace the request's.
    const headers =
      init?.headers === undefined ? request?.headers : new Headers(init.headers);
    return (
      method.toUpperCase() === "HEAD" ||
      headers?.has("range") === true ||
      (init?.cache ?? request?.cache) === "no-store"
    );
  } catch {
    // Malformed input: let fetch reject it as it would without this wrapper.
    return false;
  }
}

export function createPlatformFetch(
  originalFetch: typeof fetch,
  readEnvironment: () => Record<string, unknown>,
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const binding = readEnvironment()[PLATFORM_FETCH_BINDING_NAME] as
      | Partial<FetchBinding>
      | null
      | undefined;
    if (
      typeof binding?.fetch !== "function" ||
      !needsPlatformFetch(input, init)
    ) {
      return originalFetch(input, init);
    }
    return binding.fetch(input, init);
  };
}

export function installPlatformFetch(): void {
  if (platformFetchInstalled) return;

  globalThis.fetch = createPlatformFetch(
    globalThis.fetch.bind(globalThis),
    workerEnvironment,
  );
  platformFetchInstalled = true;
}
