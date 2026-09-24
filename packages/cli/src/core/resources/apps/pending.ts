import type { ConversationMessage } from "@/core/resources/apps/api.js";

/**
 * What the agent is waiting on. A tool call parked with
 * `status: waiting_for_user_input` carries its request in its own arguments
 * (sent in full for a waiting call); guard-parked calls carry a verdict in
 * `results`. This turns those into one shape the session can render and the
 * atoms can print, per kind: approval (yes/no), choice (questions with
 * options), input (a form: secrets), permissions (checkbox rows).
 */
export type PendingKind =
  | "approval"
  | "choice"
  | "secrets"
  | "permissions"
  | "browser"
  /** register_workspace_connector: a name, then Base44's credentials or your own client id + secret. */
  | "credentials"
  /** Needs a question or form this CLI cannot render — answer in the editor. */
  | "unknown";

export interface BrowserStep {
  /** "connector": start OAuth for `integrationType`; "github": the account's GitHub link. */
  flow: "connector" | "github";
  integrationType?: string;
  connectorId?: string;
  scopes?: string[];
  forceReconnect?: boolean;
}

interface PendingOption {
  label: string;
  description?: string;
}

export interface PendingQuestion {
  question: string;
  description?: string;
  options: PendingOption[];
  multiSelect: boolean;
}

export interface PendingSecret {
  name: string;
  description?: string;
}

export interface PendingPermission {
  /** The key the answer names: entity:<name> · backend_function:<name> · app_user_connector:<id>. */
  key: string;
  label: string;
  reason?: string;
}

export interface PendingInput {
  toolCallId: string;
  messageId: string;
  tool: string;
  kind: PendingKind;
  /** One line saying what is being asked. */
  title: string;
  /** Supporting text: the summary, the guard's reason, the permission request's reason. */
  detail?: string;
  questions?: PendingQuestion[];
  /** For a single list choice: the `extra_user_input` key the tool expects (e.g. "provider"). */
  answerKey?: string;
  /** For kind "browser": how to run the step the web runs in a popup. */
  browser?: BrowserStep;
  /** For kind "credentials": the connector and the scopes the agent asked for. */
  credentials?: {
    integrationType: string;
    suggestedName?: string;
    scopes: string[];
  };
  secrets?: PendingSecret[];
  permissions?: PendingPermission[];
}

const CHOICE_TOOLS = new Set([
  "ask_clarifying_questions",
  "ask_plan_questions",
]);
const SECRET_TOOLS = new Set(["set_secrets"]);
/** A single-choice tool whose options live in one arguments array. */
const LIST_CHOICE_TOOLS: Record<
  string,
  { key: string; question: string; answer: string }
> = {
  select_payment_provider: {
    key: "providers",
    question: "Which payment provider?",
    answer: "provider",
  },
};
const PERMISSION_TOOLS = new Set(["request_agent_tool_permissions"]);
/** Approval only after a step the web runs (OAuth popup, payments form). */
const CREDENTIALS_TOOLS = new Set(["register_workspace_connector"]);
const BROWSER_TOOLS = new Set([
  "connect_github_account",
  "request_oauth_authorization",
  "configure_psp_credentials",
  "plaid_connect",
]);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

function parseArgs(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function questionsFrom(args: Record<string, unknown>): PendingQuestion[] {
  const raw = Array.isArray(args.questions) ? args.questions : [];
  return raw.flatMap((q) => {
    if (!q || typeof q !== "object") return [];
    const item = q as Record<string, unknown>;
    const question = str(item.question);
    if (!question) return [];
    const options = (Array.isArray(item.options) ? item.options : []).flatMap(
      (o) => {
        const opt = o as Record<string, unknown>;
        const label = str(opt?.label);
        return label ? [{ label, description: str(opt.description) }] : [];
      },
    );
    return [
      {
        question,
        description: str(item.description),
        options,
        multiSelect: item.multi_select === true,
      },
    ];
  });
}

function secretsFrom(args: Record<string, unknown>): PendingSecret[] {
  const raw = Array.isArray(args.secrets_schema) ? args.secrets_schema : [];
  return raw.flatMap((s) => {
    const item = s as Record<string, unknown>;
    const name = str(item?.secretName) ?? str(item?.name);
    return name ? [{ name, description: str(item.description) }] : [];
  });
}

/** Same key the backend derives (`AgentToolPermissionRequest.key`). */
export function permissionKey(row: Record<string, unknown>): string | null {
  switch (row.type) {
    case "entity":
      return row.entity_name ? `entity:${row.entity_name}` : null;
    case "backend_function":
      return row.function_name ? `backend_function:${row.function_name}` : null;
    case "app_user_connector":
      return row.connector_id ? `app_user_connector:${row.connector_id}` : null;
    default:
      return null;
  }
}

function permissionsFrom(args: Record<string, unknown>): PendingPermission[] {
  const raw = Array.isArray(args.requested_permissions)
    ? args.requested_permissions
    : [];
  return raw.flatMap((r) => {
    const row = r as Record<string, unknown>;
    const key = permissionKey(row);
    if (!key) return [];
    const ops = Array.isArray(row.allowed_operations)
      ? ` (${(row.allowed_operations as unknown[]).join(", ")})`
      : "";
    const target =
      str(row.entity_name) ??
      str(row.function_name) ??
      str(row.connector_name) ??
      key;
    return [
      { key, label: `${row.type}: ${target}${ops}`, reason: str(row.reason) },
    ];
  });
}

function guardFrom(
  results: unknown,
): { title: string; detail?: string } | null {
  const value =
    typeof results === "string"
      ? (() => {
          try {
            return JSON.parse(results) as unknown;
          } catch {
            return null;
          }
        })()
      : results;
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  if (!str(g.guard)) return null;
  return { title: `${g.guard}: needs your approval`, detail: str(g.reason) };
}

function humanize(tool: string): string {
  return tool.replace(/_/g, " ");
}

/** Every parked tool call in the conversation, oldest first. */
export function pendingInputs(messages: ConversationMessage[]): PendingInput[] {
  const out: PendingInput[] = [];
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      if (call.status !== "waiting_for_user_input") continue;
      const args = parseArgs(call.arguments_string);
      const base = {
        toolCallId: call.id,
        messageId: message.id,
        tool: call.name,
      };
      const summary = str(args.summary);
      if (CHOICE_TOOLS.has(call.name)) {
        out.push({
          ...base,
          kind: "choice",
          title: summary ?? "The agent has a few questions",
          questions: questionsFrom(args),
        });
      } else if (SECRET_TOOLS.has(call.name)) {
        out.push({
          ...base,
          kind: "secrets",
          title: summary ?? "The agent needs secrets",
          secrets: secretsFrom(args),
        });
      } else if (PERMISSION_TOOLS.has(call.name)) {
        out.push({
          ...base,
          kind: "permissions",
          title: summary ?? "Grant the app's agent these permissions?",
          detail: str(args.reason),
          permissions: permissionsFrom(args),
        });
      } else if (LIST_CHOICE_TOOLS[call.name]) {
        const spec = LIST_CHOICE_TOOLS[call.name];
        const raw = Array.isArray(args[spec.key])
          ? (args[spec.key] as unknown[])
          : [];
        const options = raw.flatMap((o) => {
          const label =
            typeof o === "string"
              ? o
              : str((o as Record<string, unknown>)?.label);
          return label ? [{ label }] : [];
        });
        out.push({
          ...base,
          kind: "choice",
          title: summary ?? spec.question,
          detail: str(args.reason),
          questions: [{ question: spec.question, options, multiSelect: false }],
          answerKey: spec.answer,
        });
      } else if (CREDENTIALS_TOOLS.has(call.name)) {
        const integration = str(args.integration_type) ?? "connector";
        out.push({
          ...base,
          kind: "credentials",
          title:
            summary ?? `Register ${integration} credentials for this workspace`,
          detail: str(args.description),
          credentials: {
            integrationType: integration,
            suggestedName: str(args.name),
            scopes: Array.isArray(args.scopes)
              ? (args.scopes as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : [],
          },
        });
      } else if (BROWSER_TOOLS.has(call.name)) {
        const integration = str(args.integration_type);
        out.push({
          ...base,
          kind: "browser",
          title:
            summary ??
            (call.name === "connect_github_account"
              ? "Connect your GitHub account"
              : integration
                ? `Authorize ${integration}`
                : humanize(call.name)),
          detail: str(args.reason),
          browser:
            call.name === "connect_github_account"
              ? { flow: "github" }
              : {
                  flow: "connector",
                  integrationType: integration,
                  connectorId: str(args.connector_id),
                  scopes: Array.isArray(args.scopes)
                    ? (args.scopes as unknown[]).filter(
                        (x): x is string => typeof x === "string",
                      )
                    : undefined,
                  forceReconnect: args.force_reconnect === true,
                },
        });
      } else if (
        call.waiting_on?.kind === "choice" ||
        call.waiting_on?.kind === "input"
      ) {
        // A tool this CLI does not know how to render: say so instead of
        // offering a yes/no that would answer the wrong question.
        out.push({
          ...base,
          kind: "unknown",
          title: summary ?? humanize(call.name),
          detail: str(args.reason),
        });
      } else {
        const guard = guardFrom(call.results);
        const integration = str(args.integration_type);
        out.push({
          ...base,
          kind: "approval",
          title:
            guard?.title ??
            (integration
              ? `Enable ${integration}?`
              : (summary ?? `${humanize(call.name)}?`)),
          detail: guard?.detail ?? (integration ? summary : undefined),
        });
      }
    }
  }
  return out;
}

export interface ChoiceSelection {
  /** Selected option labels; several only for multi-select questions. */
  labels: string[];
  /** Free text for "something else". */
  customText?: string;
}

/** `extra_user_input` for a choice card, in the web client's shape. */
export function choiceAnswers(
  questions: PendingQuestion[],
  selections: ChoiceSelection[],
  answerKey?: string,
): Record<string, unknown> {
  if (answerKey) {
    const first = selections[0];
    return { [answerKey]: first?.labels[0] ?? first?.customText ?? "" };
  }
  const answers = questions.flatMap((q, index) => {
    const sel = selections[index];
    if (!sel || (sel.labels.length === 0 && !sel.customText)) return [];
    const answer: Record<string, unknown> = { question_index: index };
    if (q.multiSelect) {
      if (sel.labels.length) answer.selected_labels = sel.labels;
    } else if (sel.labels[0]) {
      answer.selected_label = sel.labels[0];
    }
    if (sel.customText) answer.custom_text = sel.customText;
    return [answer];
  });
  return { answers };
}
