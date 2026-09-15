import chalk from "chalk";
import { Box, render, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useReducer, useRef, useState } from "react";
import stripAnsi from "strip-ansi";
import { expandPrompt } from "@/cli/commands/imported/expansions.js";
import { createPasteFriendlyStdin } from "@/cli/commands/imported/paste.js";
import {
  formatDuration,
  hardWrapAnsi,
  idleMusing,
} from "@/cli/commands/imported/render.js";
import type {
  SessionEngine,
  SessionStatus,
  TurnSettleInfo,
} from "@/cli/commands/imported/session-engine.js";
import { createSessionEngine } from "@/cli/commands/imported/session-engine.js";
import { readAuth } from "@/core/auth/config.js";
import { getBase44ApiUrl } from "@/core/config.js";
import packageJson from "../../../../package.json";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Alternate screen (Claude Code model): the session owns the viewport with
// its own internal scroll; the shell screen is restored untouched on exit.
// Mode 1007 makes the mouse wheel send arrow keys, which drive the scroll.
let altScreenActive = false;
let altExitHooked = false;
function enterAltScreen(): void {
  process.stdout.write("\x1b[?1049h\x1b[?1007h\x1b[2J\x1b[H");
  altScreenActive = true;
  if (!altExitHooked) {
    altExitHooked = true;
    process.on("exit", () => {
      if (altScreenActive) process.stdout.write("\x1b[?1007l\x1b[?1049l");
    });
  }
}
function exitAltScreen(): void {
  if (!altScreenActive) return;
  altScreenActive = false;
  process.stdout.write("\x1b[?1007l\x1b[?1049l");
}

interface SessionOptions {
  branchId?: string;
  /** Live footer lines (repo/editor/preview) — pushing appends to the block. */
  footer: string[];
  /** Swallow whatever the conversation already holds before showing anything —
   * false for a fresh create, whose kickoff turn IS the history. */
  primeFirstPoll: boolean;
  /** Sent as the first turn right after priming (the `chat` argument). */
  initialMessage?: string;
  /** A turn is already starting server-side (the create kickoff): show this
   * as the busy label until its user message appears, instead of "ready". */
  awaitingTurnLabel?: string;
  /** Shown next to "ready" when nothing is running. */
  idleHint?: string;
  onTurnSettled?: (info: TurnSettleInfo) => void | Promise<void>;
}

function statusText(status: SessionStatus, musingSeed: number): string {
  const frame = FRAMES[Math.floor(Date.now() / 120) % FRAMES.length];
  switch (status.phase) {
    case "awaiting":
      return chalk.dim(
        `${frame} ${status.awaitingLabel} (${formatDuration(Date.now() - status.awaitingSince)})`,
      );
    case "running": {
      const turnFor = formatDuration(
        Date.now() - (status.turnStartedAt ?? Date.now()),
      );
      const tool = status.runningTool;
      if (tool) {
        const toolFor = Math.round((Date.now() - tool.startedAt) / 1000);
        const others = tool.others > 0 ? ` (+${tool.others})` : "";
        const what =
          tool.label ||
          `${tool.alias}${tool.summary ? ` ${tool.summary}` : ""}`;
        return chalk.dim(
          `${frame} ${what}${others} · ${toolFor}s (turn ${turnFor})`,
        );
      }
      // Long silent stretch: some arms (plan/design) run minutes-long model
      // calls whose UI renders only in the editor — say so instead of
      // looking frozen.
      const quiet =
        status.quietForMs > 60_000
          ? " · a long private step — details render in the editor"
          : "";
      return `${chalk.magenta("✻")} ${chalk.dim(`${idleMusing(musingSeed)} (${turnFor})${quiet}`)}`;
    }
    case "sending":
      return chalk.dim(`${frame} sending…`);
    case "idle": {
      const hint = status.idleHint ? ` — ${status.idleHint}` : "";
      const last =
        status.lastTurnMs != null
          ? ` · last turn ${formatDuration(status.lastTurnMs)}${status.lastTurnOk ? "" : " (failed)"}`
          : "";
      return chalk.dim(`ready${hint}${last}`);
    }
  }
}

interface ViewProps {
  engine: SessionEngine;
  footer: string[];
  subscribe: (listener: (line: string) => void) => () => void;
}

/** Terminal lines a history item occupies, wrap-aware (estimate). */
function lineCount(item: string, columns: number): number {
  return item
    .split("\n")
    .reduce(
      (sum, line) =>
        sum + Math.max(1, Math.ceil(stripAnsi(line).length / columns)),
      0,
    );
}

function SessionView({ engine, footer, subscribe }: ViewProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [scroll, setScroll] = useState(0); // lines up from the live bottom
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [musingSeed] = useState(() => Math.floor(Math.random() * 97));
  const maxScrollRef = useRef(0);

  useEffect(
    // The trailing newline gives every stream item a blank line after it.
    () => subscribe((line) => setItems((h) => [...h, `${line}\n`])),
    [subscribe],
  );
  useEffect(() => {
    const timer = setInterval(tick, 120);
    return () => clearInterval(timer);
  }, []);

  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      if (input) setInput("");
      else exit();
      return;
    }
    if (key.ctrl && char === "d") {
      exit();
      return;
    }
    // Wheel scrolling: alternate-scroll mode turns it into arrow keys.
    if (key.upArrow) {
      setScroll((s) => Math.min(s + 3, maxScrollRef.current));
      return;
    }
    if (key.downArrow) {
      setScroll((s) => Math.max(0, s - 3));
      return;
    }
    if (key.pageUp) {
      setScroll((s) => Math.min(s + 20, maxScrollRef.current));
      return;
    }
    if (key.pageDown) {
      setScroll((s) => Math.max(0, s - 20));
      return;
    }
    if (key.escape) setScroll(0);
  });

  const columns = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const width = Math.min(columns, 100);
  const innerWidth = Math.max(10, width - 4); // input border + padding
  const inputRows = Math.max(1, Math.ceil((input.length + 2) / innerWidth));
  const widgetHeight = 4 + inputRows + (footer.length ? 1 : 0); // status + border + hint + links
  const viewHeight = Math.max(3, rows - widgetHeight - 1);

  // Hard-wrapped physical lines of the whole transcript; the view is a
  // window over them, pinned to the bottom unless the user scrolled.
  const lines = items.flatMap((item) => hardWrapAnsi(item, columns));
  const maxScroll = Math.max(0, lines.length - viewHeight);
  maxScrollRef.current = maxScroll;
  const clamped = Math.min(scroll, maxScroll);
  const end = lines.length - clamped;
  const visible = lines.slice(Math.max(0, end - viewHeight), end);

  const scrollNote =
    clamped > 0
      ? chalk.yellow(
          ` ↑ scrolled ${clamped} lines — Esc or scroll down for live`,
        )
      : "";

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" height={viewHeight}>
        {visible.map((line, index) => (
          <Text key={`${index}-${line.length}`}>{line || " "}</Text>
        ))}
      </Box>
      <Text>
        {statusText(engine.status(), musingSeed)}
        {scrollNote}
      </Text>
      <Box borderStyle="round" borderColor="gray" paddingX={1} width={width}>
        <Text color="cyan">{"❯ "}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={(value) => {
            if (value.trim()) engine.submit(value);
            setInput("");
          }}
        />
      </Box>
      {footer.length > 0 && (
        <Text>{`  ${footer.join(chalk.dim("  ·  "))}`}</Text>
      )}
      <Text dimColor>
        {"  Enter to send · scroll or Esc for live · Ctrl+C to exit"}
      </Text>
    </Box>
  );
}

/**
 * The Claude-Code-style interactive session, rendered with Ink: history goes
 * permanently into scrollback via <Static>, while the bottom region — rule,
 * footer links, status line with the live turn timer, input, hints — re-renders
 * in place. Typing works mid-turn (the backend queues the message); Ctrl+C
 * clears the input, then exits; turns keep running server-side after exit.
 * TTY only — callers gate on interactivity.
 */
const BRAND_ORANGE = "#E86B3C";

/** The Base44 Code welcome box — the session's first history item, so it
 * scrolls away naturally like Claude Code's header does. */
async function buildHeader(): Promise<string> {
  const orange = chalk.hex(BRAND_ORANGE);
  let who = "";
  try {
    const auth = await readAuth();
    who = auth.name || auth.email || "";
  } catch {
    // Not logged in yet — the welcome stays generic.
  }
  const cwd = process.cwd().replace(process.env.HOME ?? "", "~");
  const inner = Math.min((process.stdout.columns || 80) - 2, 64);
  const stripLength = (s: string) => stripAnsi(s).length;
  const center = (s: string) => {
    const pad = Math.max(0, inner - stripLength(s));
    const left = Math.floor(pad / 2);
    return `│${" ".repeat(left)}${s}${" ".repeat(pad - left)}│`;
  };
  const title = ` ${orange.bold("Base44 Code")} ${chalk.dim(`v${packageJson.version}`)} `;
  const top = `╭─${title}${"─".repeat(Math.max(0, inner - stripLength(title) - 1))}╮`;
  const rowsOut = [
    top,
    center(""),
    center(chalk.bold(who ? `Welcome back, ${who}!` : "Welcome!")),
    center(""),
    // The Base44 mark: a rasterized circle (half-blocks double the vertical
    // resolution) with the slice above the bottom cap missing.
    center(orange("   ▄▄██████▄▄   ")),
    center(orange(" ▄████████████▄ ")),
    center(orange("▄██████████████▄")),
    center(orange("████████████████")),
    center(orange("▀██████████████▀")),
    center(""),
    center(orange("   ▀▀██████▀▀   ")),
    center(""),
    center(chalk.dim(getBase44ApiUrl().replace(/^https:\/\//, ""))),
    center(chalk.dim(cwd)),
    center(""),
    `╰${"─".repeat(inner)}╯`,
  ];
  return rowsOut.join("\n");
}

/** Run `work` (e.g. the create call) inside the full-page frame: header at
 * the top, a spinner on the bottom row — so the session look starts before
 * the app even exists. */
export async function withBootScreen<T>(
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const header = await buildHeader();
  enterAltScreen();
  const rows = process.stdout.rows || 24;
  const headerLines = header.split("\n").length;
  const BootScreen = () => {
    const [, tick] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
      const timer = setInterval(tick, 120);
      return () => clearInterval(timer);
    }, []);
    const frame = FRAMES[Math.floor(Date.now() / 120) % FRAMES.length];
    return (
      <Box flexDirection="column">
        <Text>{header}</Text>
        <Box height={Math.max(0, rows - headerLines - 2)} />
        <Text>{chalk.dim(`${frame} ${label}`)}</Text>
      </Box>
    );
  };
  const app = render(<BootScreen />, { exitOnCtrlC: false });
  try {
    return await work();
  } catch (error) {
    exitAltScreen(); // The error must land on the normal screen.
    throw error;
  } finally {
    app.unmount();
  }
}

export async function runInteractiveSession(
  options: SessionOptions,
): Promise<void> {
  const sessionStartedAt = Date.now();
  const listeners = new Set<(line: string) => void>();
  const buffered: string[] = [];
  const onLine = (line: string) => {
    if (listeners.size === 0) {
      buffered.push(line);
      return;
    }
    for (const listener of listeners) listener(line);
  };
  const subscribe = (listener: (line: string) => void) => {
    listeners.add(listener);
    if (buffered.length) {
      for (const line of buffered.splice(0)) listener(line);
    }
    return () => listeners.delete(listener);
  };

  const engine = createSessionEngine({
    branchId: options.branchId,
    awaitingTurnLabel: options.awaitingTurnLabel,
    idleHint: options.idleHint,
    onLine,
    onTurnSettled: options.onTurnSettled,
  });

  // Fresh viewport, Claude-Code style: clear the visible screen (shell history
  // stays in scrollback) and start at the TOP — the header renders first, and
  // the dynamic region's fixed height bottom-justifies the input widget at the
  // terminal's bottom, with the conversation filling the space between.
  enterAltScreen();
  onLine(await buildHeader());

  // Bracketed paste: the terminal wraps pastes in markers (and drops its
  // multi-line paste warning); the stdin proxy flattens them to one line.
  process.stdout.write("\x1b[?2004h");
  const stdinProxy = createPasteFriendlyStdin(process.stdin);
  const app = render(
    <SessionView
      engine={engine}
      footer={options.footer}
      subscribe={subscribe}
    />,
    { exitOnCtrlC: false, stdin: stdinProxy },
  );

  try {
    await engine.start(options.primeFirstPoll);
    if (options.initialMessage) engine.submit(options.initialMessage);
    await app.waitUntilExit();
  } finally {
    process.stdout.write("\x1b[?2004l");
    stdinProxy.cleanup();
    engine.stop();
    exitAltScreen();
    if (options.footer.length) {
      process.stdout.write(`${options.footer.join(chalk.dim("  ·  "))}\n`);
    }
    const note = engine.turnRunning()
      ? " — the running turn continues server-side (watch it in the editor)"
      : "";
    process.stdout.write(
      `${chalk.dim(`session ended · ${formatDuration(Date.now() - sessionStartedAt)}${note}`)}\n`,
    );
  }
}

interface GenesisAppConfig {
  branchId?: string;
  awaitingTurnLabel?: string;
  onTurnSettled?: (info: TurnSettleInfo) => void | Promise<void>;
}

interface GenesisOptions {
  /** Shown next to "ready" before the first prompt. */
  idleHint: string;
  /** Busy label while `createApp` runs. */
  creatingLabel: string;
  /** Live footer array — `createApp` pushes the links as they exist. */
  footer: string[];
  /** Turn the first prompt into an app; returns the wiring for the real
   * engine, which takes over every later prompt. */
  createApp: (
    prompt: string,
    emit: (line: string) => void,
  ) => Promise<GenesisAppConfig>;
}

/**
 * A session that starts BEFORE any app exists: the Base44 Code page opens
 * with just the header and the input, and the first prompt creates the app
 * (repo, directory, kickoff build) — then a real engine takes over, exactly
 * as if the session had been opened on it.
 */
export async function runGenesisSession(
  options: GenesisOptions,
): Promise<void> {
  const sessionStartedAt = Date.now();
  const listeners = new Set<(line: string) => void>();
  const buffered: string[] = [];
  const onLine = (line: string) => {
    if (listeners.size === 0) {
      buffered.push(line);
      return;
    }
    for (const listener of listeners) listener(line);
  };
  const subscribe = (listener: (line: string) => void) => {
    listeners.add(listener);
    if (buffered.length) {
      for (const line of buffered.splice(0)) listener(line);
    }
    return () => listeners.delete(listener);
  };

  let inner: SessionEngine | null = null;
  let creating = false;
  let creatingSince = 0;
  const IDLE_STATUS: SessionStatus = {
    phase: "idle",
    idleHint: options.idleHint,
    awaitingSince: 0,
    turnStartedAt: null,
    runningTool: null,
    lastTurnMs: null,
    lastTurnOk: true,
    quietForMs: 0,
  };
  const genesis: SessionEngine = {
    async start() {},
    stop() {
      inner?.stop();
    },
    submit(text: string) {
      if (inner) {
        inner.submit(text);
        return;
      }
      if (creating) {
        onLine(chalk.dim("· hold on — still creating the app"));
        return;
      }
      creating = true;
      creatingSince = Date.now();
      const expanded = expandPrompt(text);
      onLine(`${chalk.cyan("❯")} ${chalk.bold(text)}`);
      if (expanded.applied.length) {
        onLine(
          chalk.dim(
            `  ⤷ expanded ${expanded.applied.map((n) => `/${n}`).join(", ")}`,
          ),
        );
      }
      options
        .createApp(expanded.text, onLine)
        .then(async (config) => {
          const engine = createSessionEngine({
            branchId: config.branchId,
            awaitingTurnLabel: config.awaitingTurnLabel,
            onLine,
            onTurnSettled: config.onTurnSettled,
          });
          await engine.start(false);
          inner = engine;
        })
        .catch((error: unknown) => {
          creating = false;
          const message =
            error instanceof Error ? error.message : String(error);
          onLine(chalk.red(`✗ create failed: ${message}`));
        });
    },
    status(): SessionStatus {
      if (inner) return inner.status();
      if (creating) {
        return {
          ...IDLE_STATUS,
          phase: "awaiting",
          awaitingLabel: options.creatingLabel,
          awaitingSince: creatingSince,
        };
      }
      return IDLE_STATUS;
    },
    turnRunning() {
      return inner?.turnRunning() ?? creating;
    },
  };

  enterAltScreen();
  onLine(await buildHeader());

  process.stdout.write("\x1b[?2004h");
  const stdinProxy = createPasteFriendlyStdin(process.stdin);
  const app = render(
    <SessionView
      engine={genesis}
      footer={options.footer}
      subscribe={subscribe}
    />,
    { exitOnCtrlC: false, stdin: stdinProxy },
  );

  try {
    await app.waitUntilExit();
  } finally {
    process.stdout.write("\x1b[?2004l");
    stdinProxy.cleanup();
    genesis.stop();
    exitAltScreen();
    if (options.footer.length) {
      process.stdout.write(`${options.footer.join(chalk.dim("  ·  "))}\n`);
    }
    const note = genesis.turnRunning()
      ? " — the running turn continues server-side (watch it in the editor)"
      : "";
    process.stdout.write(
      `${chalk.dim(`session ended · ${formatDuration(Date.now() - sessionStartedAt)}${note}`)}\n`,
    );
  }
}
