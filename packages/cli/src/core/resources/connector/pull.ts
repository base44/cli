import { listConnectors } from "./api.js";
import type { ConnectorResource } from "./schema.js";
import { STRIPE_CONNECTOR_TYPE } from "./schema.js";
import { isStripeInstalled } from "./stripe.js";

export async function pullAllConnectors(): Promise<ConnectorResource[]> {
  const [oauthResponse, stripeInstalled] = await Promise.all([
    listConnectors(),
    isStripeInstalled(),
  ]);

  const connectors: ConnectorResource[] = oauthResponse.integrations.map(
    (i) => ({
      type: i.integrationType,
      scopes: i.scopes,
    }),
  );

  if (stripeInstalled) {
    connectors.push({ type: STRIPE_CONNECTOR_TYPE, scopes: [] });
  }

  return connectors;
}
