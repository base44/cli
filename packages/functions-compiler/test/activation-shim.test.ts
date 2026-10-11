/**
 * Node-level checks of the activation shim's pure pieces. The pull itself runs
 * end to end in workerd in runtime-secrets.e2e.test.ts; the proof primitive is
 * pinned here against the backend's known-answer vector so the two stacks can
 * never drift apart silently.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { activationProof, errorDigest, markerDigest } from "../src/shim/activation";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SHIM_SOURCE = here("../src/shim/activation.ts");
// The backend's closed reason set: ISOLATE_ERROR_REASONS in apper's
// backend/app/cloudflare_functions/activation_challenge.py. A reason missing there
// reads as `malformed`, so a change on either side must change both.
const BACKEND_REASONS = [
  "challenge_missing", "url_missing", "key_missing", "url_not_https",
  "endpoint_unreachable", "endpoint_timeout", "endpoint_400", "endpoint_401",
  "endpoint_409", "endpoint_429", "endpoint_4xx", "endpoint_5xx",
  "response_malformed", "blob_missing", "blob_unreadable", "internal",
];

function names(block: string): string[] {
  return [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]).sort();
}

describe("activation digests", () => {
  it("match the backend known-answer vectors", async () => {
    const challenge = "1.eyJhIjoiYXBwIn0.c2lnbmF0dXJl";
    expect(await errorDigest("endpoint_timeout", challenge)).toBe("NT2Yz8fa-XuO_luyVuuBHfQh9tuKvNaa2Ei0-XQ5FYo");
    expect(await markerDigest(challenge)).toBe("ZwCuzyBu0wb1kw7U4J2R2xFqUl2rnjwIbXVFoj1EFvo");
  });
});

describe("activation proof", () => {
  it("matches the backend known-answer vector", async () => {
    expect(
      await activationProof(
        "CKo9hqqgQUb4ObVTci2FI1v5eyhRRT7h4I09JG_yqiI",
        "1.eyJhIjoiYXBwIn0.c2lnbmF0dXJl",
      ),
    ).toBe("uOxAcFTuzUkHXhpwvwlVPD2UgxVa9mEt6PuapyHogUI");
  });
});


describe("activation reasons", () => {
  it("are exactly the set the backend classifies (anything else reads as `malformed`)", () => {
    const union = /export type ActivationReason =\n((?:\s*\| "[a-z0-9_]+"\n?)+)/.exec(
      readFileSync(SHIM_SOURCE, "utf8"),
    );
    expect(union).not.toBeNull();
    expect(names(union![1])).toEqual([...BACKEND_REASONS].sort());
  });
});
