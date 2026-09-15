import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import {
  createTurnStream,
  eventLine,
  formatDuration,
} from "@/cli/commands/imported/render.js";
import type { ConversationMessage } from "@/core/resources/imported/api.js";
import {
  diffConversation,
  newStreamState,
  toolMeta,
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
          arguments_string:
            '{"command": "docker compose up -d", "summary": "Boot the stack"}',
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
        label: "Boot the stack",
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
        label: "Boot the stack",
        summary: "docker compose up -d",
        ok: true,
        result: "3 containers started",
      },
    ]);

    expect(diffConversation(state, [settled])).toEqual([]);
  });

  it("splits two-tense labels: present while running, past when done", () => {
    const state = newStreamState();
    const running = assistant({
      id: "m1",
      tool_calls: [
        {
          id: "t1",
          name: "run_shell_command",
          arguments_string:
            '{"command":"astro dev --help","summary":"Checking astro dev CLI flags | Checked astro dev CLI flags"}',
          status: "running",
          results: null,
        },
      ],
    });
    const [start] = diffConversation(state, [running]);
    expect(start).toMatchObject({
      kind: "tool_start",
      label: "Checking astro dev CLI flags",
    });
    const done = assistant({
      ...running,
      tool_calls: [
        { ...running.tool_calls?.[0], status: "success", results: "ok" },
      ],
    } as ConversationMessage);
    const [end] = diffConversation(state, [done]);
    expect(end).toMatchObject({
      kind: "tool_end",
      label: "Checked astro dev CLI flags",
    });
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
        label: "",
        summary: "backend/app/db.py",
      },
      {
        kind: "tool_end",
        id: "t1",
        name: "edit_repo_file",
        label: "",
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

describe("toolMeta", () => {
  it("separates the human title (summary arg) from the salient argument", () => {
    expect(
      toolMeta(
        "run_shell_command",
        '{"command":"ls -la","summary":"List the tree"}',
      ),
    ).toEqual({ label: "List the tree", summary: "ls -la" });
    expect(
      toolMeta("write_repo_file", '{"path":"a.py","content":"…"}'),
    ).toEqual({ label: "", summary: "a.py" });
    expect(
      toolMeta("create_pull_request", '{"title":"Add auth","body":"x"}'),
    ).toEqual({ label: "", summary: "Add auth" });
  });

  it("falls back to the first non-summary string and survives non-JSON", () => {
    expect(toolMeta("set_secrets", '{"summary":"3 secrets declared"}')).toEqual(
      { label: "3 secrets declared", summary: "" },
    );
    expect(toolMeta("unknown_tool", '{"n":1,"target":"web"}')).toEqual({
      label: "",
      summary: "web",
    });
    expect(toolMeta("unknown_tool", "not json").summary).toBe("not json");
  });

  it("salvages keys from truncated arguments JSON", () => {
    // Big payloads arrive cut mid-string on the wire — JSON.parse fails, but
    // keys that survived must render instead of the raw blob.
    expect(
      toolMeta(
        "write_repo_file",
        '{"file_path": "the-sewer-vault/src/pages/shop.astro", "content": "<html>… trunc',
      ),
    ).toEqual({ label: "", summary: "the-sewer-vault/src/pages/shop.astro" });
    expect(
      toolMeta(
        "run_shell_command",
        '{"summary": "Boot the stack", "command": "docker compose up -d", "timeout": 60',
      ),
    ).toEqual({ label: "Boot the stack", summary: "docker compose up -d" });
  });

  it("truncates long values to one line", () => {
    const long = `{"command":"${"x".repeat(200)}"}`;
    expect(toolMeta("run_shell_command", long).summary).toHaveLength(91); // 90 + ellipsis
  });
});

describe("render", () => {
  it("title-first line: label leads, params on their own dim line, duration shown", () => {
    expect(
      stripAnsi(
        eventLine(
          {
            kind: "tool_end",
            id: "t1",
            name: "run_shell_command",
            label: "Confirmed Wix login",
            summary: "cd /tmp && node bootstrap.mjs",
            ok: true,
            result: '{"event":"logged_in"}',
          },
          4000,
        ) ?? "",
      ),
    ).toBe(
      '✓ Confirmed Wix login · 4s\n  bash: cd /tmp && node bootstrap.mjs\n  {"event":"logged_in"}',
    );
  });

  it("aliases tool names and keeps quiet on boring ok results", () => {
    expect(
      stripAnsi(
        eventLine({
          kind: "tool_end",
          id: "t1",
          name: "write_repo_file",
          label: "",
          summary: "frontend/src/App.jsx",
          ok: true,
          result: "Wrote frontend/src/App.jsx",
        }) ?? "",
      ),
    ).toBe("✓ write frontend/src/App.jsx");
    expect(
      eventLine({
        kind: "tool_start",
        id: "t3",
        name: "run_shell_command",
        label: "",
        summary: "ls",
      }),
    ).toBeNull();
  });

  it("formats durations for humans", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(272_000)).toBe("4m 32s");
  });

  it("non-interactive stream prints settled lines only, no ANSI cursor codes", () => {
    const out: string[] = [];
    const stream = createTurnStream(false, (text) => out.push(text));
    stream.onEvent({
      kind: "tool_start",
      id: "t1",
      name: "write_repo_file",
      label: "",
      summary: "a.py",
    });
    stream.onEvent({
      kind: "tool_end",
      id: "t1",
      name: "write_repo_file",
      label: "",
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

describe("makePasteSanitizer", () => {
  it("strips paste markers and flattens newlines to one line", async () => {
    const { makePasteSanitizer } = await import(
      "@/cli/commands/imported/paste.js"
    );
    const sanitize = makePasteSanitizer();
    expect(sanitize("\x1b[200~line one\nline two\r\nline three\x1b[201~")).toBe(
      "line one line two line three",
    );
    // Outside a paste, everything passes through untouched (Enter stays Enter).
    expect(sanitize("abc\r")).toBe("abc\r");
  });

  it("handles markers split across chunks", async () => {
    const { makePasteSanitizer } = await import(
      "@/cli/commands/imported/paste.js"
    );
    const sanitize = makePasteSanitizer();
    const out =
      sanitize("\x1b[20") +
      sanitize("0~hello\nworld\x1b[2") +
      sanitize("01~tail");
    expect(out).toBe("hello worldtail");
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
