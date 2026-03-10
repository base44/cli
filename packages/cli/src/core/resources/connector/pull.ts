import { getStripeStatus, listConnectors } from "./api.js";
import type { ConnectorResource } from "./schema.js";
import { STRIPE_CONNECTOR_TYPE } from "./schema.js";

export async function pullAllConnectors(): Promise<ConnectorResource[]> {
  const [oauthResponse, stripeStatus] = await Promise.all([
    listConnectors(),
    getStripeStatus(),
  ]);

  const connectors: ConnectorResource[] = oauthResponse.integrations.map(
    (i) => ({
      type: i.integrationType,
      scopes: i.scopes,
    }),
  );

  if (stripeStatus.stripeMode !== null) {
    connectors.push({ type: STRIPE_CONNECTOR_TYPE, scopes: [] });
  }

  return connectors;
}
