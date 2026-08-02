import type { Logger } from "@base44-cli/logger";
import { theme } from "@/cli/utils/index.js";
import type { Domain } from "@/core/domains/index.js";

export function toJsonStdout(result: unknown): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** "pending (SSL: pending_validation)" — one-line status summary. */
export function domainStatusText(domain: Domain): string {
  const status = domain.status ?? "unknown";
  const ssl = domain.sslStatus ?? "unknown";
  return domain.active ? "active" : `${status} (SSL: ${ssl})`;
}

/** A padded single-line row for the `domains list` table. */
export function formatDomainLine(domain: Domain): string {
  const status = (
    domain.active ? "active" : (domain.status ?? "unknown")
  ).padEnd(12);
  const ssl = `ssl:${domain.sslStatus ?? "unknown"}`.padEnd(22);
  return `${domain.hostname.padEnd(32)} ${status} ${ssl} → ${theme.colors.links(domain.cnameTarget)}`;
}

/**
 * Print the exact DNS record the user must add plus the current status. TLS is
 * issued automatically by Cloudflare once the CNAME resolves.
 */
export function logDomainSetup(domain: Domain, log: Logger): void {
  log.message(`${theme.styles.header("Add this DNS record")}:`);
  log.message(
    `  CNAME  ${domain.hostname}  ${theme.styles.dim("→")}  ${theme.colors.links(domain.cnameTarget)}`,
  );
  log.message(`${theme.styles.header("Status")}: ${domainStatusText(domain)}`);
  if (domain.pendingDeployment) {
    log.warn(
      "This app has no production deployment yet — the domain will start serving once the app is published.",
    );
  }
  log.message(
    theme.styles.dim(
      "TLS certificate is issued automatically once the CNAME resolves.",
    ),
  );
}
