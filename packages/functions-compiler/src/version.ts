/**
 * This package's version, as a literal.
 *
 * It goes into every compiled shard's banner, which means it is part of the
 * emitted bytes and therefore part of a deployed version's identity. Reading it
 * from `package.json` at runtime cannot work: a host that bundles this module
 * into an artifact of its own — which the CLI does — ships no `package.json`
 * beside it, and the read silently degraded to "unknown", so the same functions
 * compiled to different bytes in the CLI and in the service.
 *
 * A literal resolves in every host. `version.test.ts` fails the build if it
 * drifts from `package.json`, so bumping the package still means editing two
 * files but cannot mean forgetting one.
 */
export const COMPILER_VERSION = "0.1.1";
