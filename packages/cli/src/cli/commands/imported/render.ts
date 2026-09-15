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

// Idle-gap gerunds, one at a time, rotating every few seconds.
const MUSINGS = [
  "Shmoozing",
  "Shmoogling",
  "Percolating",
  "Noodling",
  "Marinating",
  "Brewing",
  "Simmering",
  "Conjuring",
  "Tinkering",
  "Scheming",
  "Pondering",
  "Mulling",
  "Whirring",
  "Crunching",
  "Weaving",
  "Sketching",
  "Hatching",
  "Riffing",
  "Cooking",
  "Composting ideas",
  "Rummaging",
  "Vibing responsibly",
  "Untangling",
  "Squinting at the repo",
];
const MUSING_ROTATE_MS = 6_000;

interface RunningTool {
  alias: string;
  summary: string;
  startedAt: number;
}

interface TurnStream {
  onEvent: (event: StreamEvent) => void;
  stop: () => void;
}

interface TurnStreamOptions {
  /** Lines pinned under the stream (repo/editor/preview links) — always the
   * bottom of the terminal while streaming, printed permanently on stop. Keep
   * each line under a typical terminal width: a soft-wrapped footer line
   * breaks the redraw arithmetic. */
  footer?: string[];
}

/**
 * Claude-Code-style turn view: completed items print as compact lines while a
 * live block at the bottom shows the pinned footer links and a spinner status
 * line (running tool + elapsed seconds). Non-interactive mode skips the live
 * block and just prints settled lines.
 */
export function createTurnStream(
  interactive: boolean,
  write: (text: string) => void = (text) => process.stdout.write(text),
  options: TurnStreamOptions = {},
): TurnStream {
  const running = new Map<string, RunningTool>();
  const footer = options.footer ?? [];
  let frame = 0;
  let stopped = false;
  let drawnLines = 0;
  const musingSeed = Math.floor(Math.random() * MUSINGS.length);

  const statusLabel = (): string => {
    if (running.size === 0) {
      const index =
        (musingSeed + Math.floor(Date.now() / MUSING_ROTATE_MS)) %
        MUSINGS.length;
      return `${MUSINGS[index]}…`;
    }
    const newest = [...running.values()].at(-1) as RunningTool;
    const elapsed = Math.round((Date.now() - newest.startedAt) / 1000);
    const others = running.size > 1 ? ` (+${running.size - 1} more)` : "";
    const summary = newest.summary ? ` ${newest.summary}` : "";
    return `${newest.alias}${summary}${others} · ${elapsed}s`;
  };

  const clearBlock = () => {
    if (!drawnLines) return;
    write("\r\x1b[2K");
    for (let i = 1; i < drawnLines; i++) write("\x1b[1A\r\x1b[2K");
    drawnLines = 0;
  };

  const drawBlock = () => {
    if (!interactive || stopped) return;
    const lines = [...footer, chalk.dim(`${FRAMES[frame]} ${statusLabel()}`)];
    write(lines.join("\n"));
    drawnLines = lines.length;
  };

  const tick = () => {
    if (!interactive || stopped) return;
    frame = (frame + 1) % FRAMES.length;
    clearBlock();
    drawBlock();
  };

  const timer = interactive ? setInterval(tick, 120) : null;
  if (timer) timer.unref?.();

  return {
    onEvent(event: StreamEvent) {
      if (event.kind === "tool_start") {
        running.set(event.id, {
          alias: toolAlias(event.name),
          summary: event.summary,
          startedAt: Date.now(),
        });
        if (interactive) {
          clearBlock();
          drawBlock();
        }
        return;
      }
      if (event.kind === "tool_end") running.delete(event.id);
      const line = eventLine(event);
      if (line == null) return;
      if (interactive) {
        clearBlock();
        write(`${line}\n`);
        drawBlock();
      } else {
        write(`${line}\n`);
      }
    },
    stop() {
      if (interactive) {
        clearBlock();
        // The links outlive the stream — leave them printed for clicking.
        if (footer.length) write(`${footer.join("\n")}\n`);
      }
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
