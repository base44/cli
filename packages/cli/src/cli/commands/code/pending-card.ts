import chalk from "chalk";
import type { ToolCallAction } from "@/core/resources/apps/api.js";
import {
  type ChoiceSelection,
  choiceAnswers,
  type PendingInput,
} from "@/core/resources/apps/pending.js";

/**
 * The card the session shows when the agent is waiting on you. Pure state and
 * pure rendering, so every keystroke path is testable without Ink. Secret
 * values live here only until the answer is submitted and are never rendered.
 */
export interface CardState {
  pending: PendingInput;
  /** Question index (choice) or field index (secrets). */
  step: number;
  /** Highlighted row: an option, "something else" (choice) or a permission row. */
  cursor: number;
  /** Per question: selected labels and free text. */
  selections: ChoiceSelection[];
  /** Permission keys currently ticked. */
  granted: Set<string>;
  /** When the main input is capturing text for the card. */
  typing: "custom" | "secret" | "cred-name" | "cred-id" | "cred-secret" | null;
  /** Credentials card: the fields as they are filled. */
  cred?: {
    name?: string;
    source?: "base44" | "own";
    clientId?: string;
    clientSecret?: string;
  };
  /** Secret name → value. Dropped on submit or dismissal. */
  secretValues: Record<string, string>;
  /** Browser step: the link once started, and the outcome once known. */
  browser?: { url?: string; status: BrowserStatus };
}

export type BrowserStatus =
  | "idle"
  | "waiting"
  | "active"
  | "failed"
  | "timeout";

export type CardKey =
  | "up"
  | "down"
  | "space"
  | "enter"
  | "escape"
  | "y"
  | "n"
  | "s"
  | "b";

interface CardOutcome {
  state: CardState | null;
  /** Post this answer. */
  submit?: { action: ToolCallAction; input: Record<string, unknown> };
  /** The user chose "later": hide the card until Tab. */
  dismissed?: boolean;
  /** Start the browser step (open the link, poll the connection). */
  startBrowser?: boolean;
}

export function openCard(pending: PendingInput): CardState {
  return {
    pending,
    step: 0,
    cursor: 0,
    selections: (pending.questions ?? []).map(() => ({ labels: [] })),
    granted: new Set((pending.permissions ?? []).map((p) => p.key)),
    typing:
      pending.kind === "secrets"
        ? "secret"
        : pending.kind === "credentials"
          ? "cred-name"
          : null,
    ...(pending.kind === "credentials"
      ? { cred: { name: pending.credentials?.suggestedName } }
      : {}),
    secretValues: {},
    ...(pending.kind === "browser"
      ? { browser: { status: "idle" as const } }
      : {}),
  };
}

const done = (
  action: ToolCallAction,
  input: Record<string, unknown> = {},
): CardOutcome => ({ state: null, submit: { action, input } });
const later: CardOutcome = { state: null, dismissed: true };

/** Rows of the current choice question: its options, then "something else". */
function choiceRows(state: CardState): number {
  return (state.pending.questions?.[state.step]?.options.length ?? 0) + 1;
}

function advanceChoice(state: CardState): CardOutcome {
  const questions = state.pending.questions ?? [];
  if (state.step + 1 < questions.length) {
    return {
      state: { ...state, step: state.step + 1, cursor: 0, typing: null },
    };
  }
  return done(
    "approved",
    choiceAnswers(questions, state.selections, state.pending.answerKey),
  );
}

function choiceKey(state: CardState, key: CardKey): CardOutcome {
  const question = state.pending.questions?.[state.step];
  if (!question) return done("approved", { answers: [] });
  const rows = choiceRows(state);
  const custom = state.cursor === rows - 1;
  const sel = state.selections[state.step] ?? { labels: [] };
  const setSel = (next: ChoiceSelection): CardState => {
    const selections = [...state.selections];
    selections[state.step] = next;
    return { ...state, selections };
  };
  switch (key) {
    case "up":
      return { state: { ...state, cursor: (state.cursor - 1 + rows) % rows } };
    case "down":
      return { state: { ...state, cursor: (state.cursor + 1) % rows } };
    case "space": {
      if (custom) return { state: { ...state, typing: "custom" } };
      const label = question.options[state.cursor].label;
      const labels = question.multiSelect
        ? sel.labels.includes(label)
          ? sel.labels.filter((l) => l !== label)
          : [...sel.labels, label]
        : [label];
      return { state: setSel({ ...sel, labels }) };
    }
    case "enter": {
      if (custom) return { state: { ...state, typing: "custom" } };
      if (question.multiSelect) {
        if (sel.labels.length === 0 && !sel.customText) return { state };
        return advanceChoice(state);
      }
      const label = question.options[state.cursor].label;
      return advanceChoice(setSel({ labels: [label] }));
    }
    case "s":
      return done("approved", { answers: [] }); // the web's "skip": don't re-ask
    case "escape":
      return later;
    default:
      return { state };
  }
}

function permissionsKey(state: CardState, key: CardKey): CardOutcome {
  const rows = state.pending.permissions ?? [];
  switch (key) {
    case "up":
      return {
        state: {
          ...state,
          cursor: (state.cursor - 1 + rows.length) % rows.length,
        },
      };
    case "down":
      return { state: { ...state, cursor: (state.cursor + 1) % rows.length } };
    case "space": {
      const k = rows[state.cursor]?.key;
      if (!k) return { state };
      const granted = new Set(state.granted);
      if (granted.has(k)) granted.delete(k);
      else granted.add(k);
      return { state: { ...state, granted } };
    }
    case "enter":
    case "y":
      return done("approved", {
        approved_permission_keys: rows
          .map((r) => r.key)
          .filter((k) => state.granted.has(k)),
      });
    case "n":
      return done("rejected");
    case "escape":
      return later;
    default:
      return { state };
  }
}

/** A key while the card owns the keyboard. */
export function cardKey(state: CardState, key: CardKey): CardOutcome {
  if (state.typing) {
    // The input box has the keys; only Esc backs out of typing.
    if (key === "escape") {
      return state.typing === "secret" || state.typing === "cred-secret"
        ? later // dropping the card drops any values typed so far
        : state.typing === "custom"
          ? { state: { ...state, typing: null } }
          : later;
    }
    return { state };
  }
  switch (state.pending.kind) {
    case "choice":
      return choiceKey(state, key);
    case "permissions":
      return permissionsKey(state, key);
    case "browser": {
      const status = state.browser?.status ?? "idle";
      if (key === "n") return done("rejected");
      if (key === "escape") return later;
      if (key === "y" || key === "enter") {
        // Approve only once the connection exists; before that, start it.
        if (status === "active") return done("approved");
        if (status !== "waiting") {
          return {
            state: {
              ...state,
              browser: { ...state.browser, status: "waiting" },
            },
            startBrowser: true,
          };
        }
      }
      return { state };
    }
    case "credentials": {
      // After the name: pick the source. "b" uses Base44's credentials and
      // submits; "y" (own) moves on to typing the client id.
      if (key === "n") return done("rejected");
      if (key === "escape") return later;
      if (key === "y") {
        return {
          state: {
            ...state,
            cred: { ...state.cred, source: "own" },
            typing: "cred-id",
          },
        };
      }
      if (key === "b") {
        return done("approved", {
          name: state.cred?.name ?? "",
          credential_source: "base44",
          scopes: state.pending.credentials?.scopes ?? [],
        });
      }
      return { state };
    }
    case "unknown":
      if (key === "n") return done("rejected");
      if (key === "escape") return later;
      return { state };
    default:
      // approval: yes / no / later
      if (key === "y" || key === "enter") return done("approved");
      if (key === "n") return done("rejected");
      if (key === "escape") return later;
      return { state };
  }
}

/** The browser step progressed: a link to show, or a final outcome. */
export function browserUpdate(
  state: CardState,
  update: { url?: string; status: BrowserStatus },
): CardState {
  return {
    ...state,
    browser: { url: update.url ?? state.browser?.url, status: update.status },
  };
}

/** A line the user typed into the input box while the card was capturing it. */
export function cardText(state: CardState, text: string): CardOutcome {
  const value = text.trim();
  if (state.typing === "custom") {
    if (!value) return { state: { ...state, typing: null } };
    const selections = [...state.selections];
    const current = selections[state.step] ?? { labels: [] };
    selections[state.step] = { ...current, customText: value };
    return advanceChoice({ ...state, selections, typing: null });
  }
  if (state.typing === "cred-name") {
    const name = value || state.cred?.name || "";
    if (!name) return { state }; // a name is required
    return { state: { ...state, cred: { ...state.cred, name }, typing: null } };
  }
  if (state.typing === "cred-id") {
    if (!value) return { state };
    return {
      state: {
        ...state,
        cred: { ...state.cred, clientId: value },
        typing: "cred-secret",
      },
    };
  }
  if (state.typing === "cred-secret") {
    if (!value) return { state };
    const scopes = state.pending.credentials?.scopes ?? [];
    return done("approved", {
      name: state.cred?.name ?? "",
      client_id: state.cred?.clientId ?? "",
      client_secret: value,
      scopes,
    });
  }
  if (state.typing === "secret") {
    const fields = state.pending.secrets ?? [];
    const field = fields[state.step];
    if (!field || !value) return { state }; // empty value: stay on the field
    const secretValues = { ...state.secretValues, [field.name]: value };
    if (state.step + 1 < fields.length) {
      return { state: { ...state, secretValues, step: state.step + 1 } };
    }
    return done("approved", { secrets: secretValues });
  }
  return { state };
}

/** Everything the card shows, as terminal rows. Secret values never appear. */
export function cardLines(state: CardState): string[] {
  const p = state.pending;
  const head = [chalk.bold(`⏸ ${p.title}`)];
  if (p.detail) head.push(chalk.dim(`  ${p.detail}`));
  switch (p.kind) {
    case "choice": {
      const q = p.questions?.[state.step];
      if (!q)
        return [...head, chalk.dim("  (no questions) · Enter to continue")];
      const total = p.questions?.length ?? 1;
      const sel = state.selections[state.step] ?? { labels: [] };
      const rows = q.options.map((o, i) => {
        const on = sel.labels.includes(o.label);
        const mark = q.multiSelect ? (on ? "☑" : "☐") : on ? "●" : "○";
        const text = `${state.cursor === i ? "▸" : " "} ${mark} ${o.label}${o.description ? chalk.dim(`  — ${o.description}`) : ""}`;
        return state.cursor === i ? chalk.cyan(text) : text;
      });
      const customRow = `${state.cursor === q.options.length ? "▸" : " "} ✎ something else${sel.customText ? chalk.dim(`  — ${sel.customText}`) : ""}`;
      rows.push(
        state.cursor === q.options.length ? chalk.cyan(customRow) : customRow,
      );
      return [
        ...head,
        `  ${chalk.bold(q.question)} ${chalk.dim(`(${state.step + 1}/${total})`)}`,
        ...(q.description ? [chalk.dim(`  ${q.description}`)] : []),
        ...rows.map((r) => `  ${r}`),
        chalk.dim(
          q.multiSelect
            ? "  ↑↓ move · space toggle · Enter next · s skip all · Esc later"
            : "  ↑↓ move · Enter choose · s skip all · Esc later",
        ),
      ];
    }
    case "permissions": {
      const rows = (p.permissions ?? []).map((r, i) => {
        const text = `${state.cursor === i ? "▸" : " "} ${state.granted.has(r.key) ? "☑" : "☐"} ${r.label}${r.reason ? chalk.dim(`  — ${r.reason}`) : ""}`;
        return `  ${state.cursor === i ? chalk.cyan(text) : text}`;
      });
      return [
        ...head,
        ...rows,
        chalk.dim(
          "  space toggle · Enter grant ticked · n reject all · Esc later",
        ),
      ];
    }
    case "secrets": {
      const fields = p.secrets ?? [];
      const rows = fields.map((f, i) => {
        const filled = f.name in state.secretValues;
        const mark = filled ? chalk.green("✓") : i === state.step ? "▸" : "○";
        return `  ${mark} ${f.name}${f.description ? chalk.dim(`  — ${f.description}`) : ""}`;
      });
      return [
        ...head,
        ...rows,
        chalk.dim("  type the value below (hidden) · Enter next · Esc later"),
      ];
    }
    case "browser": {
      const b = state.browser ?? { status: "idle" as const };
      const link = b.url ? [`  ${chalk.cyan(b.url)}`] : [];
      switch (b.status) {
        case "waiting":
          return [
            ...head,
            chalk.dim("  opened in your browser — or use the link:"),
            ...link,
            chalk.dim(
              "  waiting for the authorization to complete… · n reject · Esc later",
            ),
          ];
        case "active":
          return [
            ...head,
            chalk.green("  ✓ connected"),
            chalk.dim("  y continue · n reject"),
          ];
        case "failed":
          return [
            ...head,
            chalk.red("  ✗ authorization failed"),
            chalk.dim("  y try again · n reject · Esc later"),
          ];
        case "timeout":
          return [
            ...head,
            chalk.yellow("  ⏱ no response yet"),
            ...link,
            chalk.dim("  y try again · n reject · Esc later"),
          ];
        default:
          return [
            ...head,
            chalk.dim("  y open the authorization link · n reject · Esc later"),
          ];
      }
    }
    case "credentials": {
      const c = state.cred ?? {};
      const scopes = state.pending.credentials?.scopes ?? [];
      return [
        ...head,
        `  ${c.name ? chalk.green("✓") : "▸"} name${c.name ? chalk.dim(`  — ${c.name}`) : ""}`,
        `  ${c.source ? chalk.green("✓") : c.name ? "▸" : "○"} credentials${c.source === "own" ? chalk.dim("  — your own OAuth app") : c.source === "base44" ? chalk.dim("  — Base44's") : ""}`,
        ...(c.source === "own"
          ? [
              `  ${c.clientId ? chalk.green("✓") : "▸"} client id${c.clientId ? chalk.dim(`  — ${c.clientId}`) : ""}`,
              `  ${"▸"} client secret ${chalk.dim("(hidden)")}`,
            ]
          : []),
        ...(scopes.length ? [chalk.dim(`  scopes: ${scopes.join(", ")}`)] : []),
        chalk.dim(
          !c.name
            ? "  type the connector name below · Enter · Esc later"
            : !c.source
              ? "  b use Base44's credentials · y enter your own client id + secret · n reject · Esc later"
              : "  type the value below · Enter next · Esc cancel",
        ),
      ];
    }
    case "unknown":
      return [
        ...head,
        chalk.yellow(
          "  this question needs the editor — answer it there and the session continues",
        ),
        chalk.dim("  n reject · Esc later"),
      ];
    default:
      return [...head, chalk.dim("  y approve · n reject · Esc later")];
  }
}
