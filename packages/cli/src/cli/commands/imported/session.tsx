import chalk from "chalk";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useReducer, useRef, useState } from "react";
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
import {
  displayName,
  getMe,
  MODELS,
  resolvePick,
  saveBuilderModel,
} from "@/core/model.js";
import packageJson from "../../../../package.json";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BRAND_ORANGE = "#E86B3C";

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

function SessionView({ engine, footer, subscribe }: ViewProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [scroll, setScroll] = useState(0); // lines up from the live bottom
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [musingSeed] = useState(() => Math.floor(Math.random() * 97));
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null); // null = closed
  const maxScrollRef = useRef(0);
  const meIdRef = useRef<string | null>(null);

  // Append a line straight into the transcript (for /command output that isn't
  // an engine event).
  const emit = (line: string) => setItems((h) => [...h, `${line}\n`]);

  useEffect(
    // The trailing newline gives every stream item a blank line after it.
    () => subscribe((line) => setItems((h) => [...h, `${line}\n`])),
    [subscribe],
  );
  useEffect(() => {
    const timer = setInterval(tick, 120);
    return () => clearInterval(timer);
  }, []);
  // Load the account's current builder-model pick for the footer (non-blocking).
  useEffect(() => {
    getMe()
      .then((me) => {
        meIdRef.current = me.id;
        setCurrentModel(me.builder_model ?? null);
      })
      .catch(() => {});
  }, []);

  // Persist a pick and reflect it in the footer.
  const applyModel = async (pick: (typeof MODELS)[number]) => {
    const orange = chalk.hex(BRAND_ORANGE);
    try {
      if ((pick.id ?? null) === currentModel) {
        emit(chalk.dim(`  already on ${pick.name}`));
        return;
      }
      let id = meIdRef.current;
      if (!id) {
        id = (await getMe()).id;
        meIdRef.current = id;
      }
      await saveBuilderModel(id, pick.id);
      setCurrentModel(pick.id);
      emit(
        pick.id === null
          ? chalk.dim("  model reset — Base44 chooses per app")
          : `  ${orange("●")} model set to ${chalk.bold(pick.name)}`,
      );
    } catch (error) {
      emit(
        chalk.red(
          `  /model: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };

  // `/model` alone opens the arrow-navigable picker; `/model <name>` switches
  // straight away.
  const runModelSlash = (arg: string) => {
    if (!arg) {
      const cur = MODELS.findIndex((m) => (m.id ?? null) === currentModel);
      setPickerIndex(cur >= 0 ? cur : 0);
      return;
    }
    try {
      void applyModel(resolvePick(arg));
    } catch (error) {
      emit(
        chalk.red(
          `  /model: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };

  useInput((char, key) => {
    // Model picker owns the keyboard while open: arrows move the selection,
    // Enter commits, Esc/Ctrl-C cancels. Swallow everything else so it doesn't
    // scroll the transcript or type into the (hidden) input.
    if (pickerIndex !== null) {
      if (key.upArrow)
        setPickerIndex((i) => ((i ?? 0) - 1 + MODELS.length) % MODELS.length);
      else if (key.downArrow)
        setPickerIndex((i) => ((i ?? 0) + 1) % MODELS.length);
      else if (key.return) {
        const pick = MODELS[pickerIndex];
        setPickerIndex(null);
        void applyModel(pick);
      } else if (key.escape || (key.ctrl && char === "c")) {
        setPickerIndex(null);
      }
      return;
    }
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
    // Esc stops the running turn (like the editor's stop button); when nothing
    // is running it snaps the transcript back to live.
    if (key.escape) {
      if (engine.turnRunning()) engine.stopTurn();
      else setScroll(0);
    }
  });

  const columns = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const width = Math.min(columns, 100);
  const innerWidth = Math.max(10, width - 4); // input border + padding
  const inputRows = Math.max(1, Math.ceil((input.length + 3) / innerWidth)); // +cursor cell
  const pickerOpen = pickerIndex !== null;
  // The bottom block is either the input box (inputRows + 2 border) or the model
  // picker (title + one row per model + 2 border). +3 = status + model/timer +
  // hint; +1 more for the footer links when present.
  const inputBlockHeight = pickerOpen ? MODELS.length + 3 : inputRows + 2;
  const widgetHeight = inputBlockHeight + 3 + (footer.length ? 1 : 0);
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
    clamped > 0 ? chalk.yellow(` ↑ ${clamped} lines — Esc for live`) : "";
  // The status row must stay EXACTLY one row or the whole widget bounces —
  // truncate it (and every transcript row) instead of letting them wrap.
  const statusLine = hardWrapAnsi(
    `${statusText(engine.status(), musingSeed)}${scrollNote}`,
    Math.max(10, columns - 1),
  )[0];

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" height={viewHeight}>
        {visible.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: windowed slice re-renders wholesale each frame; position is the identity
          <Text key={`${index}-${line.length}`} wrap="truncate-end">
            {line || " "}
          </Text>
        ))}
      </Box>
      <Text wrap="truncate-end">{statusLine}</Text>
      {pickerOpen ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          width={width}
        >
          <Text>
            {chalk.bold("Pick a model")}
            {chalk.dim("   ↑↓ move · Enter select · Esc cancel")}
          </Text>
          {MODELS.map((m, i) => {
            const selected = i === pickerIndex;
            const isCurrent = (m.id ?? null) === currentModel;
            const label = `${selected ? "▸" : " "} ${isCurrent ? "●" : "○"} ${m.name}${m.note ? `  (${m.note})` : ""}`;
            return (
              <Text
                key={m.name}
                color={selected ? "cyan" : undefined}
                wrap="truncate-end"
              >
                {selected ? label : chalk.dim(label)}
              </Text>
            );
          })}
        </Box>
      ) : (
        <Box borderStyle="round" borderColor="gray" paddingX={1} width={width}>
          <Text color="cyan">{"❯ "}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (trimmed === "/model" || trimmed.startsWith("/model ")) {
                runModelSlash(trimmed.slice("/model".length).trim());
              } else if (trimmed) {
                engine.submit(value);
              }
              setInput("");
            }}
          />
        </Box>
      )}
      {footer.length > 0 && (
        <Text wrap="truncate-end">{`  ${footer.join(chalk.dim("  ·  "))}`}</Text>
      )}
      <Text wrap="truncate-end">
        {`  ${chalk.dim("model")} ${chalk.hex(BRAND_ORANGE)(displayName(currentModel))}`}
      </Text>
      <Text dimColor wrap="truncate-end">
        {pickerOpen
          ? "  ↑↓ to move · Enter to select · Esc to cancel"
          : engine.turnRunning()
            ? "  Esc to stop · type to queue · scroll to read · Ctrl+C to exit"
            : "  Enter to send · /model to switch model · Esc for live · Ctrl+C to exit"}
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
// The Base44 mark, rendered rather than hand-drawn: a round sun with one thin
// blank stripe (the setting-sun slit). Built from QUADRANT blocks — 2x2 sub-pixels
// per character — for smooth curved edges (half-blocks only round top/bottom, so
// the sides came out jagged). Terminal cells are ~2:1, and a quadrant sub-cell is
// ~1:2, so we use 2x as many sub-columns as sub-rows (`sx = 2 * sy`) to correct
// the aspect and keep the disc round instead of a tall oval. LOGO_ROWS = height in
// text rows; LOGO_GAP_SUBROW = the cleared sub-row (0..2*LOGO_ROWS-1), low in the
// disc. Rows are trimmed so renderHeader's center() aligns them.
const LOGO_ROWS = 7;
const LOGO_GAP_SUBROW = 11;
// Index by tl | tr<<1 | bl<<2 | br<<3 (the four 2x2 sub-pixels of one cell).
const QUAD = " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█";
function buildLogoRows(): string[] {
  const sy = 2 * LOGO_ROWS;
  const sx = 2 * sy;
  const cx = (sx - 1) / 2;
  const cy = (sy - 1) / 2;
  const rad = sy / 2 - 0.5;
  const on = (px: number, py: number): boolean => {
    if (py === LOGO_GAP_SUBROW) return false;
    const dx = (px - cx) * 0.5;
    const dy = py - cy;
    // No tolerance: a positive fudge over-fills the poles (nearly-flat there) and
    // makes the top/bottom bulge instead of reading as a smooth arc.
    return dx * dx + dy * dy <= rad * rad;
  };
  const rows: string[] = [];
  for (let ty = 0; ty < sy; ty += 2) {
    let row = "";
    for (let tx = 0; tx < sx; tx += 2) {
      const bits =
        (on(tx, ty) ? 1 : 0) |
        (on(tx + 1, ty) ? 2 : 0) |
        (on(tx, ty + 1) ? 4 : 0) |
        (on(tx + 1, ty + 1) ? 8 : 0);
      row += QUAD[bits];
    }
    rows.push(row.trim());
  }
  return rows.map((row) => row.trim());
}

/** The welcome header, Claude-Code style: the sun mark on the left, the title /
 * account / cwd lines stacked to its right. No box. */
function renderHeader(who: string): string {
  const orange = chalk.hex(BRAND_ORANGE);
  const cwd = process.cwd().replace(process.env.HOME ?? "", "~");
  const logo = buildLogoRows();
  const logoW = Math.max(...logo.map((r) => r.length));
  const center = (s: string) => {
    const total = Math.max(0, logoW - s.length);
    const left = Math.floor(total / 2);
    return " ".repeat(left) + s + " ".repeat(total - left);
  };
  const text = [
    `${orange.bold("Base44 Code")} ${chalk.dim(`v${packageJson.version}`)}`,
    chalk.bold(who ? `Welcome back, ${who}!` : "Welcome!"),
    chalk.dim(getBase44ApiUrl().replace(/^https:\/\//, "")),
    chalk.dim(cwd),
  ];
  const height = Math.max(logo.length, text.length);
  const textTop = Math.max(0, Math.floor((logo.length - text.length) / 2));
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const left = i < logo.length ? orange(center(logo[i])) : " ".repeat(logoW);
    const right = text[i - textTop] ?? "";
    out.push(`  ${left}   ${right}`.trimEnd());
  }
  return out.join("\n");
}

async function currentUserName(): Promise<string> {
  try {
    const auth = await readAuth();
    return auth.name || auth.email || "";
  } catch {
    return ""; // Not logged in yet — the welcome stays generic.
  }
}

/** The Base44 Code welcome box — the session's first history item, so it
 * scrolls away naturally like Claude Code's header does. */
async function buildHeader(): Promise<string> {
  return renderHeader(await currentUserName());
}

/** Run `work` (e.g. the create call) inside the full-page frame: header at
 * the top, a spinner on the bottom row — so the session look starts before
 * the app even exists. */
export async function withBootScreen<T>(
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const who = await currentUserName();
  enterAltScreen();
  const rows = process.stdout.rows || 24;
  const header = renderHeader(who);
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
    stopTurn() {
      // Only a real engine can stop a server turn; app creation isn't stoppable.
      inner?.stopTurn();
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
