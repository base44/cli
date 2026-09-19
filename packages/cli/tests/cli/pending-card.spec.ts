import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import {
  browserUpdate,
  cardKey,
  cardLines,
  cardText,
  openCard,
} from "@/cli/commands/code/pending-card.js";
import type { PendingInput } from "@/core/resources/apps/pending.js";

const base = { toolCallId: "tc1", messageId: "m1" };

describe("pending card", () => {
  it("approval: y approves, n rejects, Esc defers", () => {
    const p: PendingInput = {
      ...base,
      tool: "enable_connector",
      kind: "approval",
      title: "Enable wix_stores?",
    };
    expect(cardKey(openCard(p), "y").submit).toEqual({
      action: "approved",
      input: {},
    });
    expect(cardKey(openCard(p), "n").submit).toEqual({
      action: "rejected",
      input: {},
    });
    expect(cardKey(openCard(p), "escape")).toEqual({
      state: null,
      dismissed: true,
    });
    expect(stripAnsi(cardLines(openCard(p)).join("\n"))).toContain(
      "y approve · n reject · Esc later",
    );
  });

  it("choice: single-select picks on Enter and moves on; the last answer submits the web payload", () => {
    const p: PendingInput = {
      ...base,
      tool: "ask_clarifying_questions",
      kind: "choice",
      title: "Two quick questions",
      questions: [
        {
          question: "Layout?",
          options: [{ label: "Grid" }, { label: "List" }],
          multiSelect: false,
        },
        {
          question: "Sections?",
          options: [{ label: "Hero" }, { label: "FAQ" }],
          multiSelect: true,
        },
      ],
    };
    let s = openCard(p);
    s = cardKey(s, "down").state as typeof s; // → List
    let out = cardKey(s, "enter");
    expect(out.submit).toBeUndefined();
    s = out.state as typeof s;
    expect(s.step).toBe(1);
    s = cardKey(s, "space").state as typeof s; // tick Hero
    s = cardKey(s, "down").state as typeof s;
    s = cardKey(s, "space").state as typeof s; // tick FAQ
    out = cardKey(s, "enter");
    expect(out.submit).toEqual({
      action: "approved",
      input: {
        answers: [
          { question_index: 0, selected_label: "List" },
          { question_index: 1, selected_labels: ["Hero", "FAQ"] },
        ],
      },
    });
  });

  it("choice: 'something else' captures free text; s skips everything", () => {
    const p: PendingInput = {
      ...base,
      tool: "ask_clarifying_questions",
      kind: "choice",
      title: "One question",
      questions: [
        {
          question: "Colour?",
          options: [{ label: "Blue" }],
          multiSelect: false,
        },
      ],
    };
    let s = openCard(p);
    s = cardKey(s, "down").state as typeof s; // → something else
    s = cardKey(s, "enter").state as typeof s;
    expect(s.typing).toBe("custom");
    const out = cardText(s, "  warm terracotta ");
    expect(out.submit).toEqual({
      action: "approved",
      input: {
        answers: [{ question_index: 0, custom_text: "warm terracotta" }],
      },
    });
    expect(cardKey(openCard(p), "s").submit).toEqual({
      action: "approved",
      input: { answers: [] },
    });
  });

  it("permissions: rows start ticked, space toggles, Enter grants the ticked keys", () => {
    const p: PendingInput = {
      ...base,
      tool: "request_agent_tool_permissions",
      kind: "permissions",
      title: "Grant?",
      permissions: [
        { key: "entity:Task", label: "entity: Task (read)" },
        {
          key: "backend_function:sendDigest",
          label: "backend_function: sendDigest",
        },
      ],
    };
    let s = openCard(p);
    s = cardKey(s, "down").state as typeof s;
    s = cardKey(s, "space").state as typeof s; // untick sendDigest
    expect(cardKey(s, "enter").submit).toEqual({
      action: "approved",
      input: { approved_permission_keys: ["entity:Task"] },
    });
    expect(cardKey(s, "n").submit).toEqual({ action: "rejected", input: {} });
  });

  it("secrets: values are captured field by field, submitted once, and never rendered", () => {
    const p: PendingInput = {
      ...base,
      tool: "set_secrets",
      kind: "secrets",
      title: "Two secrets",
      secrets: [
        { name: "STRIPE_KEY", description: "dashboard" },
        { name: "MAIL_TOKEN" },
      ],
    };
    let s = openCard(p);
    expect(s.typing).toBe("secret");
    expect(cardText(s, "   ").state).toBe(s); // empty: stay on the field
    s = cardText(s, "sk_live_abc").state as typeof s;
    expect(s.step).toBe(1);
    const rendered = stripAnsi(cardLines(s).join("\n"));
    expect(rendered).toContain("✓ STRIPE_KEY");
    expect(rendered).not.toContain("sk_live_abc");
    const out = cardText(s, "tok_xyz");
    expect(out.submit).toEqual({
      action: "approved",
      input: { secrets: { STRIPE_KEY: "sk_live_abc", MAIL_TOKEN: "tok_xyz" } },
    });
    expect(out.state).toBeNull();
    // Esc while typing a secret drops the card and everything typed so far.
    expect(cardKey(s, "escape")).toEqual({ state: null, dismissed: true });
  });

  it("browser step: y starts the flow, approval only once connected, n rejects", () => {
    const p: PendingInput = {
      ...base,
      tool: "request_oauth_authorization",
      kind: "browser",
      title: "Authorize wix",
      browser: { flow: "connector", integrationType: "wix" },
    };
    let s = openCard(p);
    expect(stripAnsi(cardLines(s).join("\n"))).toContain(
      "y open the authorization link",
    );
    const out = cardKey(s, "y");
    expect(out.startBrowser).toBe(true);
    expect(out.submit).toBeUndefined();
    s = out.state as typeof s;
    expect(cardKey(s, "y").startBrowser).toBeUndefined(); // already waiting: y is inert
    s = browserUpdate(s, { url: "https://auth.example/x", status: "waiting" });
    expect(stripAnsi(cardLines(s).join("\n"))).toContain(
      "https://auth.example/x",
    );
    s = browserUpdate(s, { status: "failed" });
    expect(cardKey(s, "y").startBrowser).toBe(true); // retry
    s = browserUpdate(s, { status: "active" });
    expect(cardKey(s, "y").submit).toEqual({ action: "approved", input: {} });
    expect(cardKey(s, "n").submit).toEqual({ action: "rejected", input: {} });
  });

  it("unknown kind: no approval path, only reject or later", () => {
    const p: PendingInput = {
      ...base,
      tool: "future_form",
      kind: "unknown",
      title: "Fill the form",
    };
    expect(cardKey(openCard(p), "y").submit).toBeUndefined();
    expect(cardKey(openCard(p), "n").submit).toEqual({
      action: "rejected",
      input: {},
    });
    expect(stripAnsi(cardLines(openCard(p)).join("\n"))).toContain(
      "needs the editor",
    );
  });

  it("list choice submits under the tool's answer key", () => {
    const p: PendingInput = {
      ...base,
      tool: "select_payment_provider",
      kind: "choice",
      title: "Which provider?",
      answerKey: "provider",
      questions: [
        {
          question: "Which provider?",
          options: [{ label: "stripe" }, { label: "wix_payments" }],
          multiSelect: false,
        },
      ],
    };
    let s = openCard(p);
    s = cardKey(s, "down").state as typeof s;
    expect(cardKey(s, "enter").submit).toEqual({
      action: "approved",
      input: { provider: "wix_payments" },
    });
  });

  it("credentials: name, then Base44's credentials (b) or own id + hidden secret (y)", () => {
    const p: PendingInput = {
      ...base,
      tool: "register_workspace_connector",
      kind: "credentials",
      title: "Register wix credentials",
      credentials: {
        integrationType: "wix",
        suggestedName: "Wix",
        scopes: ["stores.read"],
      },
    };
    let s = openCard(p);
    expect(s.typing).toBe("cred-name");
    s = cardText(s, "").state as typeof s; // Enter keeps the suggested name
    expect(s.cred?.name).toBe("Wix");
    expect(cardKey(s, "b").submit).toEqual({
      action: "approved",
      input: {
        name: "Wix",
        credential_source: "base44",
        scopes: ["stores.read"],
      },
    });
    s = cardKey(s, "y").state as typeof s;
    expect(s.typing).toBe("cred-id");
    s = cardText(s, "id-123").state as typeof s;
    expect(s.typing).toBe("cred-secret");
    expect(stripAnsi(cardLines(s).join("\n"))).not.toContain("shh");
    const out = cardText(s, "shh");
    expect(out.submit).toEqual({
      action: "approved",
      input: {
        name: "Wix",
        client_id: "id-123",
        client_secret: "shh",
        scopes: ["stores.read"],
      },
    });
  });
});
