import type { SeedSummary } from "@/core/resources/seed/index.js";

/**
 * Human-readable per-fixture count lines for a seed summary. Shared by the
 * dev-server startup log and the `dev seed`/`dev reset` command output.
 */
export function formatSeedCounts(summary: SeedSummary): string[] {
  const lines: string[] = [];
  if (summary.users > 0) {
    lines.push(`Users: ${summary.users} seeded`);
  }
  for (const [entityName, counts] of Object.entries(summary.records)) {
    lines.push(
      `${entityName}: ${counts.created} created, ${counts.updated} updated, ${counts.skipped} skipped`,
    );
  }
  if (lines.length === 0) {
    lines.push("Nothing to seed");
  }
  return lines;
}
