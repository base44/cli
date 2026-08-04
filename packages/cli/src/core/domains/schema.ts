import { z } from "zod";

// ─── SHARED ──────────────────────────────────────────────────

/**
 * DNS / ownership details Cloudflare returns for a pending custom hostname.
 * Values are provider-shaped and opaque to the CLI, so they pass through as
 * `unknown` (rendered/serialized verbatim).
 */
const DomainVerificationSchema = z
  .object({
    ownership_verification: z.unknown().nullable().optional(),
    ownership_verification_http: z.unknown().nullable().optional(),
    ssl_validation_records: z.array(z.unknown()).nullable().optional(),
    ssl_validation_errors: z.array(z.unknown()).nullable().optional(),
  })
  .transform((data) => ({
    ownershipVerification: data.ownership_verification ?? null,
    ownershipVerificationHttp: data.ownership_verification_http ?? null,
    sslValidationRecords: data.ssl_validation_records ?? null,
    sslValidationErrors: data.ssl_validation_errors ?? null,
  }));

const DomainSchema = z
  .object({
    hostname: z.string(),
    cname_target: z.string(),
    status: z.string().nullable(),
    ssl_status: z.string().nullable(),
    active: z.boolean(),
    pending_deployment: z.boolean().optional(),
    verification: DomainVerificationSchema,
  })
  .transform((data) => ({
    hostname: data.hostname,
    cnameTarget: data.cname_target,
    status: data.status,
    sslStatus: data.ssl_status,
    active: data.active,
    pendingDeployment: data.pending_deployment ?? false,
    verification: data.verification,
  }));

export type Domain = z.infer<typeof DomainSchema>;

// ─── REQUESTS ────────────────────────────────────────────────

/** Request payload for POST domains (sent as snake_case JSON). */
export interface AddDomainRequest {
  hostname: string;
}

// ─── RESPONSES ───────────────────────────────────────────────

/** POST domains returns a single domain view. */
export const AddDomainResponseSchema = DomainSchema;

export const DomainsListResponseSchema = z
  .object({ domains: z.array(DomainSchema) })
  .transform((data) => data.domains);

export const RemoveDomainResponseSchema = z
  .object({ hostname: z.string(), deleted: z.boolean() })
  .transform((data) => ({ hostname: data.hostname, deleted: data.deleted }));

export type RemoveDomainResponse = z.infer<typeof RemoveDomainResponseSchema>;
