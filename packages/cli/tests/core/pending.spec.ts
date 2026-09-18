import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/core/resources/apps/api.js";
import {
  choiceAnswers,
  pendingInputs,
  permissionKey,
} from "@/core/resources/apps/pending.js";

const parked = (
  name: string,
  args: Record<string, unknown>,
  results: unknown = "waiting for user input / approval",
): ConversationMessage => ({
  id: "m1",
  role: "assistant",
  tool_calls: [
    {
      id: `tc-${name}`,
      name,
      arguments_string: JSON.stringify(args),
      status: "waiting_for_user_input",
      results,
    },
  ],
});

describe("pendingInputs", () => {
  it("ignores calls that are not waiting", () => {
    const done = parked("enable_connector", {
      integration_type: "wix_stores",
      summary: "x",
    });
    (done.tool_calls as { status: string }[])[0].status = "success";
    expect(pendingInputs([done])).toEqual([]);
  });

  it("reads a connector approval", () => {
    const [p] = pendingInputs([
      parked("enable_connector", {
        integration_type: "wix_stores",
        summary: "Sell the pillows through Wix Stores",
      }),
    ]);
    expect(p).toMatchObject({
      kind: "approval",
      toolCallId: "tc-enable_connector",
      messageId: "m1",
      title: "Enable wix_stores?",
      detail: "Sell the pillows through Wix Stores",
    });
  });

  it("reads a guard-parked call from its results", () => {
    const [p] = pendingInputs([
      parked(
        "run_shell_command",
        { command: "rm -rf dist" },
        {
          guard: "bash",
          reason: "Deletes files outside the build output",
        },
      ),
    ]);
    expect(p).toMatchObject({
      kind: "approval",
      title: "bash: needs your approval",
      detail: "Deletes files outside the build output",
    });
  });

  it("reads clarifying questions with options and multi-select", () => {
    const [p] = pendingInputs([
      parked("ask_clarifying_questions", {
        questions: [
          {
            question: "Which layout?",
            options: [
              { label: "Grid" },
              { label: "List", description: "one per row" },
            ],
          },
          {
            question: "Which sections?",
            multi_select: true,
            options: [{ label: "Hero" }, { label: "FAQ" }],
          },
        ],
      }),
    ]);
    expect(p.kind).toBe("choice");
    expect(p.questions).toEqual([
      {
        question: "Which layout?",
        description: undefined,
        multiSelect: false,
        options: [
          { label: "Grid", description: undefined },
          { label: "List", description: "one per row" },
        ],
      },
      {
        question: "Which sections?",
        description: undefined,
        multiSelect: true,
        options: [
          { label: "Hero", description: undefined },
          { label: "FAQ", description: undefined },
        ],
      },
    ]);
  });

  it("reads a secrets form without ever seeing values", () => {
    const [p] = pendingInputs([
      parked("set_secrets", {
        secrets_schema: [
          {
            secretName: "STRIPE_KEY",
            description: "From the Stripe dashboard",
          },
        ],
      }),
    ]);
    expect(p).toMatchObject({
      kind: "secrets",
      secrets: [
        { name: "STRIPE_KEY", description: "From the Stripe dashboard" },
      ],
    });
  });

  it("reads permission rows with the backend's keys", () => {
    const [p] = pendingInputs([
      parked("request_agent_tool_permissions", {
        reason: "So the assistant can manage tasks",
        requested_permissions: [
          {
            type: "entity",
            entity_name: "Task",
            allowed_operations: ["read", "update"],
          },
          { type: "backend_function", function_name: "sendDigest" },
          {
            type: "app_user_connector",
            connector_id: "c1",
            connector_name: "Gmail",
          },
        ],
      }),
    ]);
    expect(p.kind).toBe("permissions");
    expect(p.permissions?.map((r) => r.key)).toEqual([
      "entity:Task",
      "backend_function:sendDigest",
      "app_user_connector:c1",
    ]);
    expect(p.permissions?.[0].label).toBe("entity: Task (read, update)");
    expect(permissionKey({ type: "entity" })).toBeNull();
  });

  it("marks OAuth-style tools as browser steps", () => {
    const [p] = pendingInputs([parked("connect_github_account", {})]);
    expect(p.kind).toBe("browser");
  });
});

describe("choiceAnswers", () => {
  it("builds the web client's payload, skipping unanswered questions", () => {
    const questions = [
      { question: "Layout?", options: [{ label: "Grid" }], multiSelect: false },
      {
        question: "Sections?",
        options: [{ label: "Hero" }, { label: "FAQ" }],
        multiSelect: true,
      },
      { question: "Colour?", options: [{ label: "Blue" }], multiSelect: false },
    ];
    expect(
      choiceAnswers(questions, [
        { labels: ["Grid"] },
        { labels: ["Hero", "FAQ"] },
        { labels: [], customText: "Something warmer" },
      ]),
    ).toEqual({
      answers: [
        { question_index: 0, selected_label: "Grid" },
        { question_index: 1, selected_labels: ["Hero", "FAQ"] },
        { question_index: 2, custom_text: "Something warmer" },
      ],
    });
    expect(choiceAnswers(questions, [])).toEqual({ answers: [] });
  });
});
