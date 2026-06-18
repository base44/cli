import { createHash, randomBytes } from "node:crypto";

interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(
    createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}
