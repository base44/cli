import { getStripeStatus, installStripe, removeStripe } from "./api.js";
import type { ConnectorSyncResult, StripeSyncResult } from "./push.js";
import type { ConnectorResource, StripeStatusResponse } from "./schema.js";
import { STRIPE_CONNECTOR_TYPE } from "./schema.js";

type SharedSyncResult = Extract<
  ConnectorSyncResult,
  { action: "synced" } | { action: "removed" } | { action: "error" }
>;

export async function syncStripeConnector(
  localStripe: ConnectorResource | undefined,
): Promise<ConnectorSyncResult | null> {
  const remoteStatus = await fetchStripeRemoteStatus();

  if (remoteStatus === "error") {
    return localStripe
      ? stripeError("Failed to check Stripe integration status")
      : null;
  }

  const isRemoteInstalled = remoteStatus.stripeMode !== null;
  const needsInstall = localStripe && !isRemoteInstalled;
  const alreadySynced = localStripe && isRemoteInstalled;
  const needsRemoval = !localStripe && isRemoteInstalled;

  if (needsInstall) {
    return handleStripeInstall();
  }

  if (alreadySynced) {
    return stripeSynced();
  }

  if (needsRemoval) {
    return handleStripeRemoval();
  }

  return null;
}

export async function isStripeInstalled(): Promise<boolean> {
  const status = await getStripeStatus();
  return status.stripeMode !== null;
}

async function fetchStripeRemoteStatus(): Promise<
  StripeStatusResponse | "error"
> {
  try {
    return await getStripeStatus();
  } catch {
    return "error";
  }
}

async function handleStripeInstall(): Promise<ConnectorSyncResult> {
  try {
    const result = await installStripe();
    return stripeProvisioned(result.claimUrl ?? undefined);
  } catch (err) {
    return stripeError(err instanceof Error ? err.message : String(err));
  }
}

async function handleStripeRemoval(): Promise<ConnectorSyncResult> {
  try {
    await removeStripe();
    return stripeRemoved();
  } catch (err) {
    return stripeError(err instanceof Error ? err.message : String(err));
  }
}

function stripeSynced(): SharedSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "synced" };
}

function stripeProvisioned(claimUrl?: string): StripeSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "provisioned", claimUrl };
}

function stripeRemoved(): SharedSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "removed" };
}

function stripeError(error: string): SharedSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "error", error };
}
