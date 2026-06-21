import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { type DevEnv, listEnvs } from "@/core/dev/registry.js";

function uptime(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  const mins = Math.floor(ms / 60000);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function table(envs: DevEnv[]): string {
  const header = ["NAME", "STATUS", "URL", "UPTIME", "PROJECT"];
  const rows = envs.map((e) => [
    e.name,
    e.status,
    e.url,
    uptime(e.createdAt),
    e.projectRoot,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const fmt = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join("   ");
  return [fmt(header), ...rows.map(fmt)].join("\n");
}

async function devPsAction(
  _ctx: CLIContext,
  options: { json?: boolean },
): Promise<RunCommandResult> {
  const envs = await listEnvs();
  if (options.json) {
    return { stdout: `${JSON.stringify(envs, null, 2)}\n` };
  }
  if (envs.length === 0) {
    return { outroMessage: "No dev envs. Start one with: base44 dev run -d" };
  }
  return { stdout: `${table(envs)}\n` };
}

export function getPsCommand(): Command {
  return new Base44Command("ps", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("List background dev envs")
    .option("--json", "Output machine-readable JSON")
    .action(devPsAction);
}
