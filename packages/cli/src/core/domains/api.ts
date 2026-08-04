import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import {
  ApiError,
  SchemaValidationError,
  TimeoutError,
} from "@/core/errors.js";
import type {
  AddDomainRequest,
  Domain,
  RemoveDomainResponse,
} from "./schema.js";
import {
  AddDomainResponseSchema,
  DomainsListResponseSchema,
  RemoveDomainResponseSchema,
} from "./schema.js";

/** Connect a custom domain to the app (creates the CF custom hostname). */
export async function addDomain(hostname: string): Promise<Domain> {
  const appClient = getAppClient();

  const request: AddDomainRequest = { hostname };
  let response: KyResponse;
  try {
    response = await appClient.post("domains", {
      json: request,
      timeout: 120_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "connecting domain");
  }

  const result = AddDomainResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

/** List the custom domains connected to the app, with live status. */
export async function listDomains(): Promise<Domain[]> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("domains");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing domains");
  }

  const result = DomainsListResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

/** Disconnect a custom domain (deletes the CF custom hostname + route). */
export async function removeDomain(
  hostname: string,
): Promise<RemoveDomainResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.delete(
      `domains/${encodeURIComponent(hostname)}`,
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "removing domain");
  }

  const result = RemoveDomainResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

interface WaitForDomainOptions {
  /** Poll interval in ms (default 2000). */
  intervalMs?: number;
  /** Give up after this many ms (default 10 minutes). */
  timeoutMs?: number;
  /** Called with the latest domain state (or undefined) on each poll. */
  onTick?: (domain: Domain | undefined) => void;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `listDomains` until `hostname` is fully active (hostname + SSL), then
 * resolve with it. Throws `TimeoutError` if it never activates within the
 * budget — typically because the CNAME record hasn't been added yet.
 */
export async function waitForDomainActive(
  hostname: string,
  options: WaitForDomainOptions = {},
): Promise<Domain> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const domain = (await listDomains()).find((d) => d.hostname === hostname);
    options.onTick?.(domain);
    if (domain?.active) {
      return domain;
    }
    if (Date.now() >= deadline) {
      throw new TimeoutError(
        `Timed out waiting for ${hostname} to become active`,
      );
    }
    await delay(intervalMs);
  }
}
