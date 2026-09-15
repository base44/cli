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

export function toolAlias(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/** OSC 8 terminal hyperlink: a short clickable label instead of a wrapping
 * URL — the whole link opens regardless of line width. */
export function terminalLink(label: string, url: string): string {
  return `\u001B]8;;${url}\u0007${chalk.dim.underline(label)}\u001B]8;;\u0007`;
}

/** Hard-wrap ANSI-styled text at `width` visible columns, keeping style
 * continuity across breaks (reset at the break, reopen the active SGR codes).
 * Narrow but dependency-free — all input here is our own chalk output. */
export function hardWrapAnsi(text: string, width: number): string[] {
  const ESC = /^(?:\u001b\[[0-9;]*m|\u001b\]8;;[^\u0007]*\u0007)/;
  const out: string[] = [];
  for (const logical of text.split("\n")) {
    let line = "";
    let visible = 0;
    let active: string[] = [];
    let i = 0;
    while (i < logical.length) {
      const esc = ESC.exec(logical.slice(i));
      if (esc) {
        const seq = esc[0];
        line += seq;
        if (seq === "\u001b[0m") active = [];
        else if (seq.endsWith("m")) active.push(seq);
        i += seq.length;
        continue;
      }
      if (visible >= width) {
        out.push(`${line}\u001b[0m`);
        line = active.join("");
        visible = 0;
      }
      line += logical[i];
      visible++;
      i++;
    }
    out.push(line);
  }
  return out;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * The finished line for an event, or null when it only affects the live
 * status (a tool starting). The tool's own human title (its `summary`
 * argument, same as the editor shows) leads; the raw salient argument is the
 * dim detail. Plain string + chalk; no layout gutter.
 */
export function eventLine(
  event: StreamEvent,
  elapsedMs?: number,
): string | null {
  switch (event.kind) {
    case "thinking":
      return chalk.dim(`✻ ${event.text}`);
    case "text":
      return event.text;
    case "tool_start":
      return null;
    case "waiting": {
      const what = event.label || toolAlias(event.name);
      return chalk.yellow(
        `⏸ ${what} — needs your input (answer in the editor)`,
      );
    }
    case "tool_end": {
      const alias = toolAlias(event.name);
      const mark = event.ok ? chalk.green("✓") : chalk.red("✗");
      const title = chalk.bold(event.label || alias);
      const took =
        elapsedMs != null && elapsedMs >= 3000
          ? ` ${chalk.dim(`· ${formatDuration(elapsedMs)}`)}`
          : "";
      // With a human title, the raw params move to their own dim line; a bare
      // alias keeps a short param (a path) inline.
      const inlineDetail =
        !event.label && event.summary ? ` ${chalk.dim(event.summary)}` : "";
      const paramsLine =
        event.label && event.summary
          ? `\n  ${chalk.dim(`${alias}: ${event.summary}`)}`
          : "";
      const head = `${mark} ${title}${inlineDetail}${took}${paramsLine}`;
      if (event.ok && (QUIET_OK_RESULTS.has(alias) || !event.result)) {
        return head;
      }
      const result = event.ok
        ? chalk.dim(event.result)
        : chalk.red(event.result);
      return `${head}${event.result ? `\n  ${result}` : ""}`;
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

/** The rotating idle gerund for a given session seed. */
export function idleMusing(seed: number): string {
  return `${MUSINGS[(seed + Math.floor(Date.now() / MUSING_ROTATE_MS)) % MUSINGS.length]}…`;
}

interface RunningTool {
  alias: string;
  label: string;
  summary: string;
  startedAt: number;
}

interface TurnStream {
  onEvent: (event: StreamEvent) => void;
  stop: () => void;
}

interface TurnStreamOptions {
  /** Lines pinned under the stream (repo/editor/preview links) — always the
   * bottom of the terminal while streaming, printed permanently on stop. The
   * array is read LIVE: pushing a line (e.g. the preview URL once fetched)
   * makes it appear on the next tick. Keep each line under a typical terminal
   * width: a soft-wrapped footer line breaks the redraw arithmetic. */
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
    const what =
      newest.label ||
      `${newest.alias}${newest.summary ? ` ${newest.summary}` : ""}`;
    return `${what}${others} · ${elapsed}s`;
  };

  const clearBlock = () => {
    if (!drawnLines) return;
    write("\r\x1b[2K");
    for (let i = 1; i < drawnLines; i++) write("\x1b[1A\r\x1b[2K");
    drawnLines = 0;
  };

  const drawBlock = () => {
    if (!interactive || stopped) return;
    // Leading blank line keeps the pinned links visually apart from the stream.
    const lines = [
      ...(footer.length ? ["", ...footer] : []),
      chalk.dim(`${FRAMES[frame]} ${statusLabel()}`),
    ];
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
          label: event.label,
          summary: event.summary,
          startedAt: Date.now(),
        });
        if (interactive) {
          clearBlock();
          drawBlock();
        }
        return;
      }
      let elapsedMs: number | undefined;
      if (event.kind === "tool_end") {
        const started = running.get(event.id)?.startedAt;
        if (started != null) elapsedMs = Date.now() - started;
        running.delete(event.id);
      }
      const line = eventLine(event, elapsedMs);
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
        // The links outlive the stream — leave them printed for clicking, set
        // apart from the prose above.
        if (footer.length) write(`\n${footer.join("\n")}\n`);
      }
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
