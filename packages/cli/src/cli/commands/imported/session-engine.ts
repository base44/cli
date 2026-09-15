import chalk from "chalk";
import {
  eventLine,
  formatDuration,
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
}

interface EngineOptions {
  branchId?: string;
  awaitingTurnLabel?: string;
  idleHint?: string;
  onLine: (line: string) => void;
  onTurnSettled?: (info: TurnSettleInfo) => void | Promise<void>;
}

export interface SessionEngine {
  start(primeFirstPoll: boolean): Promise<void>;
  stop(): void;
  submit(text: string): void;
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
export function createSessionEngine(options: EngineOptions): SessionEngine {
  const running = new Map<string, RunningTool>();
  const diffState = newStreamState();

  let stopped = false;
  let polling = false;
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

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    options.onLine(`${chalk.cyan("❯")} ${chalk.bold(text)}`);
    pendingSubmitAt = Date.now();
    sendsInFlight++;
    sendImportedChatMessage(text, options.branchId)
      .then((turn) => {
        if (turn.queued) {
          options.onLine(chalk.dim("· queued — runs after the current turn"));
        }
      })
      .catch((error: unknown) => {
        pendingSubmitAt = null;
        const message = error instanceof Error ? error.message : String(error);
        options.onLine(chalk.red(`✗ send failed: ${message}`));
      })
      .finally(() => {
        sendsInFlight--;
      });
  };

  const poll = async (prime: boolean) => {
    if (polling) return;
    polling = true;
    try {
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
          if (line != null) options.onLine(line);
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
                `— turn failed (${turn.backendStatus ?? "unknown"}) · ${formatDuration(durationMs)}`,
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
    submit,
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
        awaitingSince,
        turnStartedAt,
        runningTool,
        lastTurnMs,
        lastTurnOk,
      };
    },
    turnRunning() {
      return turnStartedAt != null;
    },
  };
}
