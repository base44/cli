// Test stub for the `npm:@base44/sdk` external import in src/shim/actor.ts.
// At deploy the Deno resolver bundles the real SDK; under vitest we only need a
// resolvable `createClient` (the actor tests never touch `this.client`).
export function createClient(config: unknown): unknown {
  return { config };
}
