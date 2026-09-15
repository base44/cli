import { emitKeypressEvents } from "node:readline";
import chalk from "chalk";
import {
  eventLine,
  formatDuration,
  idleMusing,
  toolAlias,
} from "@/cli/commands/imported/render.js";
import {
  getFullConversation,
  sendImportedChatMessage,
} from "@/core/resources/imported/api.js";
import {
  diffConversation,
  newestUserTurn,
  newStreamState,
} from "@/core/resources/imported/stream.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const POLL_MS = 1_000;
const DRAW_MS = 120;

interface RunningTool {
  alias: string;
  label: string;
  summary: string;
  startedAt: number;
}

interface TurnSettleInfo {
  turnIndex: number;
  ok: boolean;
  backendStatus?: string;
  durationMs: number;
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
  onTurnSettled?: (info: TurnSettleInfo) => void | Promise<void>;
}

/**
 * The Claude-Code-style interactive session: the conversation streams into
 * normal scrollback while a redrawn bottom region keeps the footer links, a
 * status line (activity + live turn timer + last turn), and an always-present
 * input line. Typing works mid-turn — Enter sends, and the backend queues the
 * message behind the running turn. One persistent conversation watcher covers
 * every turn, including server-queued ones. Ctrl+C clears the input, then
 * exits; Ctrl+D exits. TTY only — callers gate on interactivity.
 */
export async function runInteractiveSession(
  options: SessionOptions,
): Promise<void> {
  const write = (text: string) => process.stdout.write(text);
  const footer = options.footer;
  const running = new Map<string, RunningTool>();
  const diffState = newStreamState();
  const musingSeed = Math.floor(Math.random() * 97);
  const sessionStartedAt = Date.now();

  let frame = 0;
  let drawnLines = 0;
  let buffer = "";
  let cursor = 0;
  let exitRequested = false;
  let sendsInFlight = 0;
  let activeTurnId: string | null = null;
  let turnStartedAt: number | null = null;
  let pendingSubmitAt: number | null = null;
  let lastTurnMs: number | null = null;
  let lastTurnOk = true;
  let settledCount = 0;

  const columns = () => process.stdout.columns || 80;

  const statusLine = (): string => {
    if (turnStartedAt != null) {
      const turnFor = formatDuration(Date.now() - turnStartedAt);
      let activity: string;
      if (running.size > 0) {
        const newest = [...running.values()].at(-1) as RunningTool;
        const toolFor = Math.round((Date.now() - newest.startedAt) / 1000);
        const others = running.size > 1 ? ` (+${running.size - 1})` : "";
        const what =
          newest.label ||
          `${newest.alias}${newest.summary ? ` ${newest.summary}` : ""}`;
        activity = `${what}${others} · ${toolFor}s`;
      } else {
        activity = idleMusing(musingSeed);
      }
      return chalk.dim(`${FRAMES[frame]} ${activity} — turn ${turnFor}`);
    }
    if (sendsInFlight > 0 || pendingSubmitAt != null) {
      return chalk.dim(`${FRAMES[frame]} sending…`);
    }
    const last =
      lastTurnMs != null
        ? ` — last turn ${formatDuration(lastTurnMs)}${lastTurnOk ? "" : " (failed)"}`
        : "";
    return chalk.dim(`· ready${last}`);
  };

  const inputLine = (): { text: string; cursorCol: number } => {
    const width = Math.max(20, columns() - 4);
    const start = Math.max(0, cursor - width + 6);
    const visible = buffer.slice(start, start + width);
    const cursorCol = cursor - start;
    const body =
      buffer.length === 0
        ? chalk.dim("type · Enter sends · Ctrl+C exits")
        : visible;
    return { text: `${chalk.cyan("❯")} ${body}`, cursorCol: cursorCol + 2 };
  };

  const clearBlock = () => {
    if (!drawnLines) return;
    write("\r\x1b[2K");
    for (let i = 1; i < drawnLines; i++) write("\x1b[1A\r\x1b[2K");
    drawnLines = 0;
  };

  const drawBlock = () => {
    const input = inputLine();
    const lines = ["", ...footer, statusLine(), input.text];
    write(lines.join("\n"));
    drawnLines = lines.length;
    // Park the terminal cursor where the logical cursor sits in the input.
    if (buffer.length > 0) {
      const lineLength =
        2 + Math.min(buffer.length, Math.max(20, columns() - 4));
      const back = lineLength - input.cursorCol;
      if (back > 0) write(`\x1b[${back}D`);
    }
  };

  const redraw = () => {
    clearBlock();
    drawBlock();
  };

  const printLine = (line: string) => {
    clearBlock();
    write(`${line}\n`);
    drawBlock();
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    printLine(`${chalk.cyan("❯")} ${chalk.bold(text)}`);
    pendingSubmitAt = Date.now();
    sendsInFlight++;
    sendImportedChatMessage(text, options.branchId)
      .then((turn) => {
        if (turn.queued) {
          printLine(chalk.dim("· queued — runs after the current turn"));
        }
      })
      .catch((error: unknown) => {
        pendingSubmitAt = null;
        const message = error instanceof Error ? error.message : String(error);
        printLine(chalk.red(`✗ send failed: ${message}`));
      })
      .finally(() => {
        sendsInFlight--;
      });
  };

  const onKeypress = (
    str: string | undefined,
    key: { name?: string; ctrl?: boolean; meta?: boolean } = {},
  ) => {
    if (key.ctrl && key.name === "c") {
      if (buffer) {
        buffer = "";
        cursor = 0;
      } else {
        exitRequested = true;
      }
      redraw();
      return;
    }
    if (key.ctrl && key.name === "d") {
      exitRequested = true;
      redraw();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const text = buffer;
      buffer = "";
      cursor = 0;
      submit(text);
      return;
    }
    if (key.name === "backspace") {
      if (cursor > 0) {
        buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
        cursor--;
      }
      redraw();
      return;
    }
    if (key.name === "left") {
      cursor = Math.max(0, cursor - 1);
      redraw();
      return;
    }
    if (key.name === "right") {
      cursor = Math.min(buffer.length, cursor + 1);
      redraw();
      return;
    }
    if (key.ctrl && key.name === "a") {
      cursor = 0;
      redraw();
      return;
    }
    if (key.ctrl && key.name === "e") {
      cursor = buffer.length;
      redraw();
      return;
    }
    if (key.ctrl && key.name === "u") {
      buffer = buffer.slice(cursor);
      cursor = 0;
      redraw();
      return;
    }
    if (str && !key.ctrl && !key.meta) {
      // Paste arrives as one chunk; newlines inside it become spaces so a
      // multi-line paste is one prompt, not an accidental submit spree.
      const clean = str.replace(/[\r\n]+/g, " ");
      // Drop other control characters.
      const printable = clean.replace(/[\x00-\x1f\x7f]/g, "");
      if (!printable) return;
      buffer = buffer.slice(0, cursor) + printable + buffer.slice(cursor);
      cursor += printable.length;
      redraw();
    }
  };

  const poll = async (prime: boolean) => {
    let messages: Awaited<ReturnType<typeof getFullConversation>>;
    try {
      messages = await getFullConversation(30, options.branchId);
    } catch {
      return; // Transient — next tick retries.
    }
    const events = diffConversation(diffState, messages);
    if (!prime) {
      for (const event of events) {
        if (event.kind === "tool_start") {
          running.set(event.id, {
            alias: toolAlias(event.name),
            label: event.label,
            summary: event.summary,
            startedAt: Date.now(),
          });
          continue;
        }
        let elapsedMs: number | undefined;
        if (event.kind === "tool_end") {
          const started = running.get(event.id)?.startedAt;
          if (started != null) elapsedMs = Date.now() - started;
          running.delete(event.id);
        }
        const line = eventLine(event, elapsedMs);
        if (line != null) printLine(line);
      }
    }

    const turn = newestUserTurn(messages);
    if (!turn) return;
    if (turn.id !== activeTurnId) {
      activeTurnId = turn.id;
      if (!turn.settled) {
        turnStartedAt = pendingSubmitAt ?? Date.now();
        pendingSubmitAt = null;
        running.clear();
      } else if (prime) {
        // Session opened onto an already-finished turn — nothing to track.
        turnStartedAt = null;
      }
    }
    if (turn.settled && turnStartedAt != null && turn.id === activeTurnId) {
      const durationMs = Date.now() - turnStartedAt;
      turnStartedAt = null;
      running.clear();
      lastTurnMs = durationMs;
      const ok = !turn.backendStatus?.startsWith("error");
      lastTurnOk = ok;
      const line = ok
        ? chalk.dim(`— turn finished · ${formatDuration(durationMs)}`)
        : chalk.red(
            `— turn failed (${turn.backendStatus ?? "unknown"}) · ${formatDuration(durationMs)}`,
          );
      printLine(line);
      const info: TurnSettleInfo = {
        turnIndex: settledCount++,
        ok,
        backendStatus: turn.backendStatus,
        durationMs,
      };
      try {
        await options.onTurnSettled?.(info);
      } catch {
        // A settle hook failure must not kill the session.
      }
    }
  };

  const stdin = process.stdin;
  const supportsRaw = stdin.isTTY === true;
  emitKeypressEvents(stdin);
  if (supportsRaw) stdin.setRawMode(true);
  stdin.resume();
  stdin.on("keypress", onKeypress);
  const drawTimer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    redraw();
  }, DRAW_MS);
  drawTimer.unref?.();

  try {
    await poll(options.primeFirstPoll);
    if (options.initialMessage) submit(options.initialMessage);
    redraw();
    while (!exitRequested) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (exitRequested) break;
      await poll(false);
    }
  } finally {
    clearInterval(drawTimer);
    stdin.off("keypress", onKeypress);
    if (supportsRaw) stdin.setRawMode(false);
    stdin.pause();
    clearBlock();
    if (footer.length) write(`\n${footer.join("\n")}\n`);
    const note =
      turnStartedAt != null
        ? " — the running turn continues server-side (watch it in the editor)"
        : "";
    write(
      `${chalk.dim(`session ended · ${formatDuration(Date.now() - sessionStartedAt)}${note}`)}\n`,
    );
  }
}
