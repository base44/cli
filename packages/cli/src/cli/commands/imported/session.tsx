import chalk from "chalk";
import { Box, render, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useReducer, useState } from "react";
import { formatDuration, idleMusing } from "@/cli/commands/imported/render.js";
import type {
  SessionEngine,
  SessionStatus,
  TurnSettleInfo,
} from "@/cli/commands/imported/session-engine.js";
import { createSessionEngine } from "@/cli/commands/imported/session-engine.js";

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
        `${frame} ${status.awaitingLabel} · ${formatDuration(Date.now() - status.awaitingSince)}`,
      );
    case "running": {
      const turnFor = formatDuration(
        Date.now() - (status.turnStartedAt ?? Date.now()),
      );
      let activity: string;
      const tool = status.runningTool;
      if (tool) {
        const toolFor = Math.round((Date.now() - tool.startedAt) / 1000);
        const others = tool.others > 0 ? ` (+${tool.others})` : "";
        const what =
          tool.label ||
          `${tool.alias}${tool.summary ? ` ${tool.summary}` : ""}`;
        activity = `${what}${others} · ${toolFor}s`;
      } else {
        activity = idleMusing(musingSeed);
      }
      return chalk.dim(`${frame} ${activity} — turn ${turnFor}`);
    }
    case "sending":
      return chalk.dim(`${frame} sending…`);
    case "idle": {
      const last =
        status.lastTurnMs != null
          ? ` — last turn ${formatDuration(status.lastTurnMs)}${status.lastTurnOk ? "" : " (failed)"}`
          : "";
      return chalk.dim(`· ready${last}`);
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
        <Box flexDirection="column">
          <Text dimColor>{"─".repeat(width)}</Text>
          {footer.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
          <Text>{statusText(engine.status(), musingSeed)}</Text>
          <Box>
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

  // Fresh viewport, Claude-Code style: the visible screen clears (shell
  // history stays in scrollback) and the session owns what you see.
  process.stdout.write("\x1b[2J\x1b[H");

  const app = render(
    <SessionView
      engine={engine}
      footer={options.footer}
      subscribe={subscribe}
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
