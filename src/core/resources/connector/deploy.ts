import * as prompts from "@clack/prompts";
import {
  deleteConnector,
  initiateOAuth,
  listConnectors,
  pollOAuthStatus,
} from "@/core/resources/connector/api.js";
import type {
  ConnectorPushResult,
  ConnectorResource,
  ConnectorsPushSummary,
  IntegrationType,
  UpstreamIntegration,
} from "@/core/resources/connector/schema.js";

// Auto-added scopes by Apper for identity extraction
const AUTO_ADDED_SCOPES: Record<string, string[]> = {
  googlecalendar: ["email"],
  googledrive: ["email"],
  gmail: ["email"],
  googlesheets: ["email"],
  googledocs: ["email"],
  googleslides: ["email"],
  slack: ["users:read", "users:read.email"],
  salesforce: ["openid", "profile", "email"],
  hubspot: ["oauth"],
  linkedin: ["openid", "profile", "email"],
  tiktok: ["user.info.basic"],
  notion: [],
};

/**
 * Check if scopes match, accounting for auto-added scopes
 */
function scopesMatch(
  localScopes: string[],
  upstreamScopes: string[],
  integrationType: IntegrationType
): boolean {
  const autoAdded = AUTO_ADDED_SCOPES[integrationType] || [];
  const expectedScopes = [...localScopes, ...autoAdded].sort();
  const actualScopes = [...upstreamScopes].sort();

  return (
    expectedScopes.length === actualScopes.length &&
    expectedScopes.every((scope, i) => scope === actualScopes[i])
  );
}

/**
 * Poll OAuth status with timeout
 */
async function waitForOAuthCompletion(
  integrationType: IntegrationType,
  connectionId: string,
  timeoutMs = 300000 // 5 minutes
): Promise<"ACTIVE" | "FAILED" | "TIMEOUT"> {
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < timeoutMs) {
    const statusResponse = await pollOAuthStatus(integrationType, connectionId);

    if (statusResponse.status === "ACTIVE") {
      return "ACTIVE";
    }

    if (statusResponse.status === "FAILED") {
      return "FAILED";
    }

    // Still pending, wait and poll again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return "TIMEOUT";
}

/**
 * Handle OAuth flow for a connector
 */
async function handleOAuthFlow(
  connector: ConnectorResource,
  forceReconnect = false
): Promise<ConnectorPushResult> {
  try {
    // Initiate OAuth
    const initResponse = await initiateOAuth({
      integration_type: connector.type,
      scopes: connector.scopes,
      force_reconnect: forceReconnect,
    });

    // Show auth URL to user
    prompts.log.info(`Please authorize ${connector.type}:`);
    prompts.log.message(initResponse.redirect_url);
    prompts.log.step("Waiting for authorization...");

    // Poll for completion
    const result = await waitForOAuthCompletion(
      connector.type,
      initResponse.connection_id
    );

    if (result === "ACTIVE") {
      return {
        type: connector.type,
        status: "ACTIVE",
        details: `${connector.scopes.length} scopes`,
      };
    }

    if (result === "FAILED") {
      return {
        type: connector.type,
        status: "AUTH_FAILED",
        error: "OAuth flow failed",
      };
    }

    // Timeout
    return {
      type: connector.type,
      status: "PENDING_AUTH",
      error: "User did not complete authorization",
    };
  } catch (error) {
    return {
      type: connector.type,
      status: "AUTH_FAILED",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Process a single connector
 */
async function processConnector(
  connector: ConnectorResource,
  upstream: UpstreamIntegration | undefined
): Promise<ConnectorPushResult> {
  // Case: No upstream or disconnected/expired -> needs auth
  if (
    !upstream ||
    upstream.status === "DISCONNECTED" ||
    upstream.status === "EXPIRED"
  ) {
    return handleOAuthFlow(connector);
  }

  // Case: Active upstream - check scopes
  if (!scopesMatch(connector.scopes, upstream.scopes, connector.type)) {
    // Scopes don't match - need re-auth
    const reauthed = await handleOAuthFlow(connector, true);

    // If re-auth succeeded, check if scopes still mismatch (partial consent)
    if (reauthed.status === "ACTIVE") {
      // Re-fetch to get actual approved scopes
      const list = await listConnectors();
      const updated = list.integrations.find(
        (i) => i.integration_type === connector.type
      );

      if (
        updated &&
        !scopesMatch(connector.scopes, updated.scopes, connector.type)
      ) {
        return {
          type: connector.type,
          status: "SCOPE_MISMATCH",
          details: `Requested ${connector.scopes.length}, approved ${updated.scopes.length}`,
        };
      }
    }

    return reauthed;
  }

  // Scopes match, all good
  return {
    type: connector.type,
    status: "ACTIVE",
    details: `${connector.scopes.length} scopes`,
  };
}

/**
 * Push connectors to upstream
 */
export async function pushConnectors(
  connectors: ConnectorResource[]
): Promise<ConnectorsPushSummary> {
  if (connectors.length === 0) {
    return { results: [], hasWarnings: false, hasErrors: false };
  }

  // Fetch current upstream state
  const upstreamList = await listConnectors();
  const upstreamMap = new Map(
    upstreamList.integrations.map((i) => [i.integration_type, i])
  );

  const localTypes = new Set(connectors.map((c) => c.type));
  const results: ConnectorPushResult[] = [];

  // Process local connectors sequentially (interactive flow)
  for (const connector of connectors) {
    const upstream = upstreamMap.get(connector.type);
    const result = await processConnector(connector, upstream);
    results.push(result);
  }

  // Find connectors to delete (exist upstream but not locally)
  for (const [type, _] of upstreamMap) {
    if (!localTypes.has(type)) {
      try {
        await deleteConnector(type);
        results.push({
          type,
          status: "DELETED",
          details: "Removed (no local definition)",
        });
      } catch (error) {
        results.push({
          type,
          status: "AUTH_FAILED",
          error: `Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }
  }

  // Check for warnings/errors
  const hasWarnings = results.some((r) => r.status === "SCOPE_MISMATCH");
  const hasErrors = results.some(
    (r) => r.status === "AUTH_FAILED" || r.status === "PENDING_AUTH"
  );

  return { results, hasWarnings, hasErrors };
}
