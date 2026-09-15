import chalk from "chalk";
import type { StreamEvent } from "@/core/resources/imported/stream.js";

const TOOL_ALIASES: Record<string, string> = {
  run_shell_command: "bash",
  read_repo_file: "read",
  write_repo_file: "write",
  edit_repo_file: "edit",
  set_secrets: "secrets",
  generate_development_secrets: "secrets",
  create_pull_request: "pr",
  merge_pull_request: "merge",
  list_pr_threads: "pr threads",
  reply_to_pr_thread: "pr reply",
  comment_on_pr: "pr comment",
  resolve_pr_thread: "pr resolve",
  reload_preview: "reload",
  preview_execute_code: "preview js",
  preview_screenshot: "screenshot",
  connect_github_account: "github",
};

// Verbose result text adds nothing for these; the path in the summary does.
const QUIET_OK_RESULTS = new Set(["read", "write", "edit", "reload"]);

function toolAlias(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/**
 * The finished line for an event, or null when it only affects the live
 * status (a tool starting). Plain string + chalk; no layout gutter.
 */
export function eventLine(event: StreamEvent): string | null {
  switch (event.kind) {
    case "thinking":
      return chalk.dim(`✻ ${event.text}`);
    case "text":
      return event.text;
    case "tool_start":
      return null;
    case "tool_end": {
      const alias = toolAlias(event.name);
      const head = event.ok
        ? `${chalk.green("✓")} ${chalk.bold(alias)}`
        : `${chalk.red("✗")} ${chalk.bold(alias)}`;
      const summary = event.summary ? ` ${chalk.dim(event.summary)}` : "";
      if (event.ok && (QUIET_OK_RESULTS.has(alias) || !event.result)) {
        return `${head}${summary}`;
      }
      const result = event.ok
        ? chalk.dim(event.result)
        : chalk.red(event.result);
      return `${head}${summary}${event.result ? `\n  ${result}` : ""}`;
    }
  }
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface RunningTool {
  alias: string;
  summary: string;
  startedAt: number;
}

export interface TurnStream {
  onEvent: (event: StreamEvent) => void;
  stop: () => void;
}

/**
 * Claude-Code-style turn view: completed items print as compact lines while a
 * single live status line at the bottom shows the spinner and whatever is
 * running right now (with elapsed seconds). Non-interactive mode skips the
 * status line and just prints settled lines.
 */
export function createTurnStream(
  interactive: boolean,
  write: (text: string) => void = (text) => process.stdout.write(text),
): TurnStream {
  const running = new Map<string, RunningTool>();
  let frame = 0;
  let stopped = false;

  const statusLabel = (): string => {
    if (running.size === 0) return "waiting for the agent…";
    const newest = [...running.values()].at(-1) as RunningTool;
    const elapsed = Math.round((Date.now() - newest.startedAt) / 1000);
    const others = running.size > 1 ? ` (+${running.size - 1} more)` : "";
    const summary = newest.summary ? ` ${newest.summary}` : "";
    return `${newest.alias}${summary}${others} · ${elapsed}s`;
  };

  const drawStatus = () => {
    if (!interactive || stopped) return;
    frame = (frame + 1) % FRAMES.length;
    write(`\r\x1b[2K${chalk.dim(`${FRAMES[frame]} ${statusLabel()}`)}`);
  };

  const timer = interactive ? setInterval(drawStatus, 120) : null;
  if (timer) timer.unref?.();

  return {
    onEvent(event: StreamEvent) {
      if (event.kind === "tool_start") {
        running.set(event.id, {
          alias: toolAlias(event.name),
          summary: event.summary,
          startedAt: Date.now(),
        });
        drawStatus();
        return;
      }
      if (event.kind === "tool_end") running.delete(event.id);
      const line = eventLine(event);
      if (line == null) return;
      if (interactive) {
        write(`\r\x1b[2K${line}\n`);
        drawStatus();
      } else {
        write(`${line}\n`);
      }
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (interactive) write("\r\x1b[2K");
    },
  };
}
