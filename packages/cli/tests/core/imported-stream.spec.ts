import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { createTurnStream, eventLine } from "@/cli/commands/imported/render.js";
import type { ConversationMessage } from "@/core/resources/imported/api.js";
import {
  diffConversation,
  newStreamState,
  toolSummary,
  turnSettled,
} from "@/core/resources/imported/stream.js";

const assistant = (
  overrides: Partial<ConversationMessage> & { id: string },
): ConversationMessage => ({
  role: "assistant",
  content: null,
  ...overrides,
});

describe("diffConversation", () => {
  it("emits each item once across polls: announce, then settle, then nothing", () => {
    const state = newStreamState();
    const running = assistant({
      id: "m1",
      reasoning: { content: "Choosing FastAPI." },
      tool_calls: [
        {
          id: "t1",
          name: "run_shell_command",
          arguments_string: '{"command": "docker compose up -d"}',
          status: "running",
          results: null,
        },
      ],
    });

    expect(diffConversation(state, [running])).toEqual([
      { kind: "thinking", text: "Choosing FastAPI." },
      {
        kind: "tool_start",
        id: "t1",
        name: "run_shell_command",
        summary: "docker compose up -d",
      },
    ]);

    const settled = assistant({
      ...running,
      content: "The stack is up.",
      tool_calls: [
        {
          ...running.tool_calls?.[0],
          status: "success",
          results: "3 containers started",
        },
      ],
    } as ConversationMessage);
    expect(diffConversation(state, [settled])).toEqual([
      { kind: "text", text: "The stack is up." },
      {
        kind: "tool_end",
        id: "t1",
        name: "run_shell_command",
        summary: "docker compose up -d",
        ok: true,
        result: "3 containers started",
      },
    ]);

    expect(diffConversation(state, [settled])).toEqual([]);
  });

  it("emits only the newly appended part of growing text", () => {
    const state = newStreamState();
    diffConversation(state, [
      assistant({ id: "m1", content: "Scaffolding the backend." }),
    ]);
    expect(
      diffConversation(state, [
        assistant({
          id: "m1",
          content: "Scaffolding the backend. Now the frontend.",
        }),
      ]),
    ).toEqual([{ kind: "text", text: "Now the frontend." }]);
  });

  it("marks a failed tool and flattens structured results", () => {
    const state = newStreamState();
    expect(
      diffConversation(state, [
        assistant({
          id: "m1",
          tool_calls: [
            {
              id: "t1",
              name: "edit_repo_file",
              arguments_string: '{"path": "backend/app/db.py"}',
              status: "error",
              results: { error: "File not found" },
            },
          ],
        }),
      ]),
    ).toEqual([
      {
        kind: "tool_start",
        id: "t1",
        name: "edit_repo_file",
        summary: "backend/app/db.py",
      },
      {
        kind: "tool_end",
        id: "t1",
        name: "edit_repo_file",
        summary: "backend/app/db.py",
        ok: false,
        result: '{"error":"File not found"}',
      },
    ]);
  });

  it("ignores user and hidden messages", () => {
    const state = newStreamState();
    expect(
      diffConversation(state, [
        { id: "u1", role: "user", content: "add login" },
        assistant({ id: "h1", hidden: true, content: "internal" }),
      ]),
    ).toEqual([]);
  });

  it("a primed state suppresses history but streams what comes after", () => {
    const state = newStreamState();
    const history = assistant({ id: "m0", content: "Earlier turn summary." });
    diffConversation(state, [history]); // prime
    expect(
      diffConversation(state, [
        history,
        assistant({ id: "m1", content: "New turn begins." }),
      ]),
    ).toEqual([{ kind: "text", text: "New turn begins." }]);
  });
});

describe("toolSummary", () => {
  it("extracts the salient argument per tool", () => {
    expect(
      toolSummary("run_shell_command", '{"command":"ls -la","summary":"list"}'),
    ).toBe("ls -la");
    expect(
      toolSummary("write_repo_file", '{"path":"a.py","content":"…"}'),
    ).toBe("a.py");
    expect(
      toolSummary("create_pull_request", '{"title":"Add auth","body":"x"}'),
    ).toBe("Add auth");
  });

  it("falls back to summary, then the first string, and survives non-JSON", () => {
    expect(toolSummary("set_secrets", '{"summary":"3 secrets declared"}')).toBe(
      "3 secrets declared",
    );
    expect(toolSummary("unknown_tool", '{"n":1,"target":"web"}')).toBe("web");
    expect(toolSummary("unknown_tool", "not json")).toBe("not json");
  });

  it("truncates long values to one line", () => {
    const long = `{"command":"${"x".repeat(200)}"}`;
    expect(toolSummary("run_shell_command", long)).toHaveLength(91); // 90 + ellipsis
  });
});

describe("render", () => {
  it("aliases tool names and keeps quiet on boring ok results", () => {
    expect(
      stripAnsi(
        eventLine({
          kind: "tool_end",
          id: "t1",
          name: "write_repo_file",
          summary: "frontend/src/App.jsx",
          ok: true,
          result: "Wrote frontend/src/App.jsx",
        }) ?? "",
      ),
    ).toBe("✓ write frontend/src/App.jsx");
    expect(
      stripAnsi(
        eventLine({
          kind: "tool_end",
          id: "t2",
          name: "run_shell_command",
          summary: "docker compose ps",
          ok: true,
          result: "3 containers running",
        }) ?? "",
      ),
    ).toBe("✓ bash docker compose ps\n  3 containers running");
    expect(
      eventLine({
        kind: "tool_start",
        id: "t3",
        name: "run_shell_command",
        summary: "ls",
      }),
    ).toBeNull();
  });

  it("non-interactive stream prints settled lines only, no ANSI cursor codes", () => {
    const out: string[] = [];
    const stream = createTurnStream(false, (text) => out.push(text));
    stream.onEvent({
      kind: "tool_start",
      id: "t1",
      name: "write_repo_file",
      summary: "a.py",
    });
    stream.onEvent({
      kind: "tool_end",
      id: "t1",
      name: "write_repo_file",
      summary: "a.py",
      ok: true,
      result: "Wrote a.py",
    });
    stream.stop();
    const joined = stripAnsi(out.join(""));
    expect(joined).toBe("✓ write a.py\n");
    expect(out.join("")).not.toContain("\r");
  });
});

describe("turnSettled", () => {
  const user = (id: string, outcome: unknown): ConversationMessage => ({
    id,
    role: "user",
    content: "do it",
    outcome,
  });

  it("keys off the NEWEST user message's TERMINAL outcome", () => {
    const done = user("u1", { backend_status: "success_build" });
    const open = user("u2", null);
    // outcome is stamped "pending" at turn START — that must not read as done.
    const started = user("u3", { backend_status: "pending" });
    expect(turnSettled([done, assistant({ id: "m1" }), open])).toBe(false);
    expect(turnSettled([done, assistant({ id: "m1" }), started])).toBe(false);
    expect(turnSettled([open, assistant({ id: "m1" }), done])).toBe(true);
    expect(turnSettled([user("u4", { backend_status: "error_build" })])).toBe(
      true,
    );
    expect(turnSettled([assistant({ id: "m1" })])).toBe(false);
  });
});
