import chalk from "chalk";
import {
  eventLine,
  formatDuration,
  type TranscriptEntry,
  toolAlias,
} from "@/cli/commands/code/render.js";
import { ApiError } from "@/core/errors.js";
import {
  answerToolCall,
  getFullConversation,
  sendTurn,
  stopTurn,
  type ToolCallAction,
} from "@/core/resources/apps/api.js";
import {
  type PendingInput,
  pendingInputs,
} from "@/core/resources/apps/pending.js";
import {
  diffConversation,
  newestUserTurn,
  newStreamState,
} from "@/core/resources/apps/stream.js";

const POLL_MS = 1_000;

interface RunningTool {
  alias: string;
  label: string;
  summary: string;
  startedAt: number;
}

export interface TurnSettleInfo {
  turnIndex: number;
  ok: boolean;
  backendStatus?: string;
  durationMs: number;
}

type SessionPhase = "awaiting" | "running" | "sending" | "idle";

export interface SessionStatus {
  phase: SessionPhase;
  awaitingLabel?: string;
  idleHint?: string;
  awaitingSince: number;
  turnStartedAt: number | null;
  runningTool: {
    label: string;
    alias: string;
    summary: string;
    startedAt: number;
    others: number;
  } | null;
  lastTurnMs: number | null;
  lastTurnOk: boolean;
  /** ms since the running turn last produced a visible event. */
  quietForMs: number;
  /** Tool calls the agent parked for you, oldest first, minus ones already answered here. */
  pending: PendingInput[];
}

interface EngineOptions {
  branchId?: string;
  awaitingTurnLabel?: string;
  idleHint?: string;
  /** Scrollback sink: styled lines, or tool results kept as data for the fold. */
  onLine: (entry: TranscriptEntry) => void;
  onTurnSettled?: (info: TurnSettleInfo) => void | Promise<void>;
}

export interface SessionEngine {
  start(primeFirstPoll: boolean): Promise<void>;
  stop(): void;
  submit(text: string): void;
  /** Answer a parked tool call. Posts, then lets the poller stream the turn it resumes. */
  answer(
    pending: PendingInput,
    action: ToolCallAction,
    input?: Record<string, unknown>,
  ): void;
  /** Stop the running turn server-side (like the editor's stop button). */
  stopTurn(): void;
  status(): SessionStatus;
  turnRunning(): boolean;
}

/**
 * Everything about a session except pixels: the persistent conversation
 * watcher, turn-state derivation from the newest user message's outcome
 * stamp, and message submission (including mid-turn sends the backend
 * queues). Emits already-styled scrollback lines through `onLine`; the UI
 * layer renders them plus a status snapshot.
 */
/**
 * A request that stays open for a whole turn (chat/message, submit-tool-call-
 * input) can be cut by the edge or a proxy long after the backend took it:
 * a 5xx, a timeout, or a bare transport error ("fetch failed", ECONNRESET,
 * socket hang up). None of those mean the turn failed — the poller shows it
 * running. Only a real API rejection (4xx) is a failure to report.
 */
export function isConnectionDrop(error: unknown): boolean {
  const status = error instanceof ApiError ? error.statusCode : undefined;
  if (status === 502 || status === 503 || status === 504) return true;
  if (status != null) return false;
  const text = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error
      ? String((error as { cause?: unknown }).cause ?? "")
      : "",
  ].join(" ");
  return /timeout|gateway|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|network|aborted|UND_ERR/i.test(
    text,
  );
}

export function createSessionEngine(options: EngineOptions): SessionEngine {
  const running = new Map<string, RunningTool>();
  const diffState = newStreamState();

  let stopped = false;
  let polling = false;
  let pollStartedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let sendsInFlight = 0;
  let activeTurnId: string | null = null;
  let turnStartedAt: number | null = null;
  let pendingSubmitAt: number | null = null;
  let lastTurnMs: number | null = null;
  let lastTurnOk = true;
  let settledCount = 0;
  let awaitingTurn = options.awaitingTurnLabel ?? null;
  const awaitingSince = Date.now();
  let lastEventAt = Date.now();

  let pending: PendingInput[] = [];
  const answered = new Set<string>();

  const answer = (
    p: PendingInput,
    action: ToolCallAction,
    input: Record<string, unknown> = {},
  ) => {
    answered.add(p.toolCallId);
    pending = pending.filter((x) => x.toolCallId !== p.toolCallId);
    const verb =
      action === "rejected"
        ? chalk.red("✗ rejected")
        : Object.keys(input).length
          ? chalk.green("→ answered")
          : chalk.green("✓ approved");
    options.onLine(`${verb} ${chalk.dim("—")} ${p.title}`);
    pendingSubmitAt = Date.now();
    sendsInFlight++;
    answerToolCall(
      { toolCallId: p.toolCallId, messageId: p.messageId, action, input },
      options.branchId,
    )
      .catch((error: unknown) => {
        // A dropped connection after the backend took the answer is not a
        // failure — the resumed turn shows in the stream. Report only a real
        // rejection, or a drop with no sign the turn started.
        if (
          isConnectionDrop(error) &&
          (turnStartedAt != null || pendingSubmitAt == null)
        ) {
          return;
        }
        answered.delete(p.toolCallId);
        pendingSubmitAt = null;
        options.onLine(
          chalk.red(
            `✗ answer failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      })
      .finally(() => {
        sendsInFlight--;
      });
  };

  const submit = (raw: string) => {
    const typed = raw.trim();
    if (!typed) return;
    const text = typed;
    options.onLine(`${chalk.cyan("❯")} ${chalk.bold(typed)}`);
    pendingSubmitAt = Date.now();
    const submitTurnId = activeTurnId;
    sendsInFlight++;
    sendTurn(text, options.branchId)
      .then((turn) => {
        if (turn.queued) {
          options.onLine(chalk.dim("· queued — runs after the current turn"));
        }
      })
      .catch((error: unknown) => {
        // The chat request stays open for the whole turn, so a long turn trips
        // the edge's request timeout (~100s) with a 5xx even though
        // the message reached the backend and the turn is running. If the
        // poller has since picked up a new turn (activeTurnId advanced, or the
        // submit marker was consumed), the send was delivered — not a failure.
        const delivered =
          activeTurnId !== submitTurnId ||
          turnStartedAt != null ||
          pendingSubmitAt == null;
        if (isConnectionDrop(error) && delivered) return; // Running — the stream shows it.
        pendingSubmitAt = null;
        const message = error instanceof Error ? error.message : String(error);
        options.onLine(chalk.red(`✗ send failed: ${message}`));
      })
      .finally(() => {
        sendsInFlight--;
      });
  };

  const poll = async (prime: boolean) => {
    // Re-entrancy guard, but time-bounded: if a previous poll's request wedged
    // (a hung fetch that never resolves or rejects), a plain boolean would block
    // every future poll forever — the turn settles server-side but the UI stays
    // stuck on "running" with the timer ticking. After STUCK_POLL_MS, let a new
    // poll through so settle is still detected.
    const STUCK_POLL_MS = 45_000;
    if (polling && Date.now() - pollStartedAt < STUCK_POLL_MS) return;
    polling = true;
    pollStartedAt = Date.now();
    try {
      let messages: Awaited<ReturnType<typeof getFullConversation>>;
      try {
        messages = await getFullConversation(30, options.branchId);
      } catch {
        return; // Transient — next tick retries.
      }
      const events = diffConversation(diffState, messages);
      // What the agent is waiting on right now; an id we answered stays hidden
      // until the backend no longer reports it waiting.
      const waiting = pendingInputs(messages);
      for (const id of answered) {
        if (!waiting.some((w) => w.toolCallId === id)) answered.delete(id);
      }
      pending = waiting.filter((w) => !answered.has(w.toolCallId));
      if (!prime) {
        for (const event of events) {
          if (event.kind === "tool_start") {
            const startedAt = Date.now();
            running.set(event.id, {
              alias: toolAlias(event.name),
              label: event.label,
              summary: event.summary,
              startedAt,
            });
            // Shown in place while it runs; the finished line replaces it.
            options.onLine({ running: event, startedAt });
            continue;
          }
          if (event.kind === "tool_end") {
            const started = running.get(event.id)?.startedAt;
            running.delete(event.id);
            lastEventAt = Date.now();
            options.onLine({
              event,
              elapsedMs: started != null ? Date.now() - started : undefined,
            });
            continue;
          }
          if (event.kind === "waiting" && answered.has(event.id)) continue;
          const line = eventLine(event, undefined, {
            waitingHint: "answer in the card below",
          });
          if (line != null) {
            lastEventAt = Date.now();
            options.onLine(line);
          }
        }
      }

      const turn = newestUserTurn(messages);
      if (!turn) return;
      const kickoffDetection = awaitingTurn != null && activeTurnId === null;
      awaitingTurn = null;
      if (turn.id !== activeTurnId) {
        activeTurnId = turn.id;
        if (!turn.settled) {
          // A kickoff was already running before this session opened — count
          // its time from session start. Later turns count from their submit.
          turnStartedAt =
            pendingSubmitAt ?? (kickoffDetection ? awaitingSince : Date.now());
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
        options.onLine(
          ok
            ? chalk.dim(`— turn finished · ${formatDuration(durationMs)}`)
            : chalk.red(
                turn.backendStatus === "error_paywall"
                  ? `— the workspace is out of credits; nothing ran · ${formatDuration(durationMs)}`
                  : `— turn failed (${turn.backendStatus ?? "unknown"}) · ${formatDuration(durationMs)}`,
              ),
        );
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
    } finally {
      polling = false;
    }
  };

  return {
    async start(primeFirstPoll: boolean) {
      await poll(primeFirstPoll);
      timer = setInterval(() => {
        if (!stopped) void poll(false);
      }, POLL_MS);
      timer.unref?.();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    stopTurn() {
      // Nothing running (or already sending nothing) — no-op so Esc stays free
      // for scroll-to-live when idle.
      if (
        turnStartedAt == null &&
        sendsInFlight === 0 &&
        pendingSubmitAt == null
      )
        return;
      options.onLine(chalk.dim("· stopping…"));
      // Fire-and-forget: the backend persists the stopped status, and the poller
      // settles the turn from the transcript — same path as a natural finish.
      stopTurn(options.branchId).catch((error: unknown) => {
        options.onLine(
          chalk.red(
            `  stop failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      });
    },
    submit,
    answer,
    status(): SessionStatus {
      let phase: SessionPhase = "idle";
      if (awaitingTurn != null) phase = "awaiting";
      else if (turnStartedAt != null) phase = "running";
      else if (sendsInFlight > 0 || pendingSubmitAt != null) phase = "sending";
      let runningTool: SessionStatus["runningTool"] = null;
      if (running.size > 0) {
        const newest = [...running.values()].at(-1) as RunningTool;
        runningTool = { ...newest, others: running.size - 1 };
      }
      return {
        phase,
        awaitingLabel: awaitingTurn ?? undefined,
        idleHint: options.idleHint,
        quietForMs: Date.now() - lastEventAt,
        awaitingSince,
        turnStartedAt,
        runningTool,
        lastTurnMs,
        lastTurnOk,
        pending,
      };
    },
    turnRunning() {
      return turnStartedAt != null;
    },
  };
}
