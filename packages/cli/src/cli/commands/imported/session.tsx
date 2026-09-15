import chalk from "chalk";
import { Box, render, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useReducer, useState } from "react";
import stripAnsi from "strip-ansi";
import { formatDuration, idleMusing } from "@/cli/commands/imported/render.js";
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
      return `${chalk.magenta("✻")} ${chalk.dim(`${idleMusing(musingSeed)} (${turnFor})`)}`;
    }
    case "sending":
      return chalk.dim(`${frame} sending…`);
    case "idle": {
      const last =
        status.lastTurnMs != null
          ? ` · last turn ${formatDuration(status.lastTurnMs)}${status.lastTurnOk ? "" : " (failed)"}`
          : "";
      return chalk.dim(`ready${last}`);
    }
  }
}

interface ViewProps {
  engine: SessionEngine;
  footer: string[];
  subscribe: (listener: (line: string) => void) => () => void;
  /** Fixed height of the dynamic region: the widget bottom-justifies inside
   * it, so on a fresh screen the input sits at the terminal's bottom while
   * the header stays at the top. */
  bottomHeight: number;
}

function SessionView({ engine, footer, subscribe, bottomHeight }: ViewProps) {
  const { exit } = useApp();
  const [history, setHistory] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [exiting, setExiting] = useState(false);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [musingSeed] = useState(() => Math.floor(Math.random() * 97));

  useEffect(
    () => subscribe((line) => setHistory((h) => [...h, line])),
    [subscribe],
  );
  useEffect(() => {
    const timer = setInterval(tick, 120);
    return () => clearInterval(timer);
  }, []);

  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      if (input) setInput("");
      else {
        setExiting(true);
        exit();
      }
    } else if (key.ctrl && char === "d") {
      setExiting(true);
      exit();
    }
  });

  const width = Math.min(process.stdout.columns || 80, 100);
  return (
    <>
      <Static items={history}>
        {(line, index) => <Text key={`${index}`}>{line}</Text>}
      </Static>
      {exiting ? (
        <Box flexDirection="column">
          {footer.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Box>
      ) : (
        <Box
          flexDirection="column"
          justifyContent="flex-end"
          height={bottomHeight}
        >
          <Text>{statusText(engine.status(), musingSeed)}</Text>
          <Box
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            width={width}
          >
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
          {footer.map((line) => (
            <Text key={line}>{`  ${line}`}</Text>
          ))}
          <Text dimColor>
            {"  Enter to send · Ctrl+C to exit (turns keep running)"}
          </Text>
        </Box>
      )}
    </>
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
    // The Base44 mark: a full circle with its bottom slice cut flat.
    center(orange("▄▄██████▄▄")),
    center(orange("████████████")),
    center(orange("████████████")),
    center(orange("▀██████████▀")),
    center(""),
    center(chalk.dim(getBase44ApiUrl().replace(/^https:\/\//, ""))),
    center(chalk.dim(cwd)),
    center(""),
    `╰${"─".repeat(inner)}╯`,
  ];
  return rowsOut.join("\n");
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
    onLine,
    onTurnSettled: options.onTurnSettled,
  });

  // Fresh viewport, Claude-Code style: clear the visible screen (shell history
  // stays in scrollback) and start at the TOP — the header renders first, and
  // the dynamic region's fixed height bottom-justifies the input widget at the
  // terminal's bottom, with the conversation filling the space between.
  const rows = process.stdout.rows || 24;
  process.stdout.write("\x1b[2J\x1b[H");
  const header = await buildHeader();
  onLine(header);
  const headerLines = header.split("\n").length;
  const bottomHeight = Math.max(10, rows - headerLines - 1);

  const app = render(
    <SessionView
      engine={engine}
      footer={options.footer}
      subscribe={subscribe}
      bottomHeight={bottomHeight}
    />,
    { exitOnCtrlC: false },
  );

  try {
    await engine.start(options.primeFirstPoll);
    if (options.initialMessage) engine.submit(options.initialMessage);
    await app.waitUntilExit();
  } finally {
    engine.stop();
    const note = engine.turnRunning()
      ? " — the running turn continues server-side (watch it in the editor)"
      : "";
    process.stdout.write(
      `${chalk.dim(`session ended · ${formatDuration(Date.now() - sessionStartedAt)}${note}`)}\n`,
    );
  }
}
