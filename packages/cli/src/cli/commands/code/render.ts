import chalk from "chalk";
import type { StreamEvent } from "@/core/resources/apps/stream.js";

const TOOL_ALIASES: Record<string, string> = {
  run_shell_command: "bash",
  read_repo_file: "read",
  write_repo_file: "write",
  edit_repo_file: "edit",
  read_file: "read",
  write_file: "write",
  find_replace: "edit",
  delete_file: "delete",
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
const QUIET_OK_RESULTS = new Set(["read", "write", "edit", "reload", "delete"]);

/** Folding: what a tool result shows before you ask for the rest. */
const RESULT_LINE_MAX = 110;
const DIFF_LINES_MAX = 12;
const ERROR_LINES_MAX = 8;

interface EventLineOptions {
  /** Show every line of every result: no folding, no truncation. */
  verbose?: boolean;
  /** How to unfold, named in the fold marker (e.g. "Ctrl+O to expand"). */
  foldHint?: string;
  /** Where a parked tool gets answered (default: the editor). */
  waitingHint?: string;
}

/** A transcript item: a finished, styled line, or a tool result kept as data so
 * the fold can be toggled after the fact. */
export type TranscriptEntry =
  | string
  | { event: Extract<StreamEvent, { kind: "tool_end" }>; elapsedMs?: number }
  | {
      running: Extract<StreamEvent, { kind: "tool_start" }>;
      startedAt: number;
    };

export function renderEntry(
  entry: TranscriptEntry,
  options: EventLineOptions = {},
): string {
  if (typeof entry === "string") return entry;
  if ("running" in entry) return runningLine(entry.running, entry.startedAt);
  return eventLine(entry.event, entry.elapsedMs, options) ?? "";
}

const RUNNING_DOT = "#E86B3C";
const PULSE_MS = 500;

/** A tool still running, in place in the transcript: a pulsing dot, the tool's
 * title, how long it has been at it, and its command or path underneath. The
 * finished line replaces it. */
export function runningLine(
  event: Extract<StreamEvent, { kind: "tool_start" }>,
  startedAt: number,
  now: number = Date.now(),
): string {
  const lit = Math.floor(now / PULSE_MS) % 2 === 0;
  const dot = lit ? chalk.hex(RUNNING_DOT)("●") : chalk.dim("●");
  const alias = toolAlias(event.name);
  const title = chalk.bold(event.label || alias);
  const inline =
    !event.label && event.summary ? ` ${chalk.dim(event.summary)}` : "";
  const seconds = Math.round((now - startedAt) / 1000);
  const took = seconds >= 3 ? ` ${chalk.dim(`· ${seconds}s`)}` : "";
  const detail =
    event.label && event.summary
      ? `\n  ${chalk.dim(`└ ${alias}: ${event.summary}`)}`
      : "";
  return `${dot} ${title}${inline}${took}${detail}`;
}

function fold(
  lines: string[],
  max: number,
  options: EventLineOptions,
): string[] {
  if (options.verbose || lines.length <= max) return lines;
  const hint = options.foldHint ? ` (${options.foldHint})` : "";
  return [
    ...lines.slice(0, max),
    chalk.dim(`… +${lines.length - max} lines${hint}`),
  ];
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** An edit as the change itself: the removed text, then the inserted text. */
function diffLines(args: Record<string, unknown>): string[] | null {
  const find = str(args.find);
  const replace = str(args.replace);
  if (find == null && replace == null) return null;
  return [
    ...(find ?? "").split("\n").map((l) => chalk.red(`- ${l}`)),
    ...(replace ?? "").split("\n").map((l) => chalk.green(`+ ${l}`)),
  ];
}

const indent = (lines: string[]): string =>
  lines.map((l) => `  ${l}`).join("\n");

export function toolAlias(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

// Terminal control bytes, built from char codes so this source carries no raw
// ESC/BEL and no ambiguous escape literals.
const ESC_CHAR = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC8_CLOSE = `${ESC_CHAR}]8;;${BEL}`;

/** OSC 8 terminal hyperlink: a short clickable label instead of a wrapping
 * URL - the whole link opens regardless of line width. */
export function terminalLink(label: string, url: string): string {
  return `${ESC_CHAR}]8;;${url}${BEL}${chalk.dim.underline(label)}${OSC8_CLOSE}`;
}

/** Wrap bare http(s) URLs in a plain-text string as OSC 8 hyperlinks, so a URL
 * a hard wrap would split still opens in full on ctrl/cmd-click. Each link gets
 * an `id=` so terminals join its segments across wrapped rows (paired with
 * hardWrapAnsi, which reopens the active link on every continuation row). The
 * visible text stays the URL. Input must be plain text (no existing OSC 8), so
 * only call it on raw backend text, never on already-linked output. */
function linkifyUrls(text: string): string {
  let n = 0;
  return text.replace(/https?:\/\/[^\s]+/g, (raw) => {
    // Trailing sentence punctuation is not part of the URL.
    const trailing = raw.match(/[.,;:!?)\]}'"]+$/)?.[0] ?? "";
    const url = trailing ? raw.slice(0, -trailing.length) : raw;
    const id = `b44-${n++}`;
    return `${ESC_CHAR}]8;id=${id};${url}${BEL}${url}${OSC8_CLOSE}${trailing}`;
  });
}

/** Hard-wrap ANSI-styled text at `width` visible columns, keeping style
 * continuity across breaks (reset at the break, reopen the active SGR codes and
 * any active OSC 8 hyperlink so a wrapped link stays whole). Narrow but
 * dependency-free - all input here is our own chalk / linkifyUrls output. */
export function hardWrapAnsi(text: string, width: number): string[] {
  const ESC = new RegExp(
    `^(?:${ESC_CHAR}\\[[0-9;]*m|${ESC_CHAR}\\]8;[^${BEL}]*${BEL})`,
  );
  const RESET = `${ESC_CHAR}[0m`;
  const out: string[] = [];
  for (const logical of text.split("\n")) {
    let line = "";
    let visible = 0;
    let active: string[] = [];
    let link = ""; // the active OSC 8 open sequence, or "" when none is open
    let i = 0;
    while (i < logical.length) {
      const esc = ESC.exec(logical.slice(i));
      if (esc) {
        const seq = esc[0];
        line += seq;
        if (seq === RESET) active = [];
        else if (seq.endsWith("m")) active.push(seq);
        else if (seq === OSC8_CLOSE) link = "";
        else link = seq; // an OSC 8 open (carries id + url)
        i += seq.length;
        continue;
      }
      if (visible >= width) {
        // Close the link before the break, then reopen it (same id) on the next
        // row so the terminal treats both halves as one hyperlink.
        out.push(`${line}${link ? OSC8_CLOSE : ""}${RESET}`);
        line = active.join("") + link;
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
  options: EventLineOptions = {},
): string | null {
  switch (event.kind) {
    case "thinking":
      return chalk.dim(`✻ ${event.text}`);
    case "text":
      return linkifyUrls(event.text);
    case "tool_start":
      return null;
    case "waiting": {
      const what = event.label || toolAlias(event.name);
      return chalk.yellow(
        `⏸ ${what} — needs your input (${options.waitingHint ?? "answer in the editor"})`,
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
      const args = event.args ?? null;
      if (event.ok && alias === "edit" && args) {
        // The change itself, Claude-Code style, instead of "Success".
        const diff = diffLines(args);
        if (diff)
          return `${head}\n${indent(fold(diff, DIFF_LINES_MAX, options))}`;
      }
      if (event.ok && alias === "write" && args && str(args.content) != null) {
        const lines = (str(args.content) as string).split("\n");
        const count = chalk.dim(`+${lines.length} lines`);
        if (!options.verbose) return `${head} ${count}`;
        return `${head} ${count}\n${indent(lines.map((l) => chalk.dim(l)))}`;
      }
      if (event.ok && (QUIET_OK_RESULTS.has(alias) || !event.result)) {
        return head;
      }
      const paint = event.ok ? chalk.dim : chalk.red;
      const lines = event.result
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l, i, all) => l.length > 0 || (i > 0 && i < all.length - 1));
      if (event.ok && !options.verbose) {
        // One line of a successful result; the rest is a keypress away.
        const first = lines[0] ?? "";
        const cut =
          first.length > RESULT_LINE_MAX
            ? `${first.slice(0, RESULT_LINE_MAX)}…`
            : first;
        const more = lines.length - 1;
        const hint = options.foldHint ? ` (${options.foldHint})` : "";
        const tail = more > 0 ? chalk.dim(` … +${more} lines${hint}`) : "";
        return `${head}\n  ${paint(linkifyUrls(cut))}${tail}`;
      }
      // Errors are never cut mid-sentence: a few full lines, then a fold.
      const shown = fold(
        lines.map((l) => paint(linkifyUrls(l))),
        event.ok ? Number.POSITIVE_INFINITY : ERROR_LINES_MAX,
        options,
      );
      return `${head}\n${indent(shown)}`;
    }
  }
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// The thinking glyph pulses through these and back, Claude-Code style.
const SHIMMER = ["·", "✢", "✳", "✶", "✻", "✽"];
const SHIMMER_STEP_MS = 120;

/** The pulsing "thinking" glyph for a given moment. */
export function shimmer(now: number = Date.now()): string {
  const period = SHIMMER.length * 2 - 2; // forward then back, no repeated ends
  const step = Math.floor(now / SHIMMER_STEP_MS) % period;
  const index = step < SHIMMER.length ? step : period - step;
  return SHIMMER[index];
}

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
  /** Shown while no tool is running — e.g. the pre-first-turn provisioning wait. Defaults to a rotating musing. */
  idleLabel?: string;
  /** Lines pinned under the stream (repo/editor/preview links) — always the
   * bottom of the terminal while streaming, printed permanently on stop. The
   * array is read LIVE: pushing a line (e.g. the preview URL once fetched)
   * makes it appear on the next tick. Keep each line under a typical terminal
   * width: a soft-wrapped footer line breaks the redraw arithmetic. */
  footer?: string[];
  /** Render every result unfolded (`--verbose`). */
  verbose?: boolean;
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
      if (options.idleLabel) return `${options.idleLabel}…`;
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
      running.size === 0
        ? `${chalk.magenta(shimmer())} ${chalk.dim(statusLabel())}`
        : chalk.dim(`${FRAMES[frame]} ${statusLabel()}`),
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
      const line = eventLine(event, elapsedMs, {
        verbose: options.verbose,
        foldHint: "--verbose shows everything",
      });
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
