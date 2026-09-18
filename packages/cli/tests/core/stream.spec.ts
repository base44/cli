import chalk from "chalk";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import {
  createTurnStream,
  eventLine,
  formatDuration,
  renderEntry,
  runningLine,
  shimmer,
} from "@/cli/commands/code/render.js";
import type { ConversationMessage } from "@/core/resources/apps/api.js";
import {
  diffConversation,
  newStreamState,
  toolMeta,
  turnSettled,
} from "@/core/resources/apps/stream.js";

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
        args: { command: "docker compose up -d", summary: "Boot the stack" },
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
        args: { path: "backend/app/db.py" },
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

  it("renders an edit as the change itself and folds long ones", () => {
    const edit = (find: string, replace: string) =>
      eventLine(
        {
          kind: "tool_end",
          id: "e1",
          name: "find_replace",
          label: "",
          summary: "src/App.jsx",
          ok: true,
          result: "Success",
          args: { file_path: "src/App.jsx", find, replace },
        },
        undefined,
        { foldHint: "Ctrl+O to expand" },
      ) ?? "";
    expect(stripAnsi(edit("a\nb", "a\nc"))).toBe(
      "✓ edit src/App.jsx\n  - a\n  - b\n  + a\n  + c",
    );
    const long = stripAnsi(
      edit(Array(10).fill("x").join("\n"), Array(10).fill("y").join("\n")),
    );
    expect(long).toContain("… +8 lines (Ctrl+O to expand)");
    expect(long.split("\n")).toHaveLength(14); // head + 12 shown + fold marker
  });

  it("verbose shows everything; writes show a line count", () => {
    const write = {
      kind: "tool_end" as const,
      id: "w1",
      name: "write_file",
      label: "",
      summary: "src/pages/Home.jsx",
      ok: true,
      result: "Edited src/pages/Home.jsx (40 chars): import React…",
      args: {
        file_path: "src/pages/Home.jsx",
        content: "import React;\n\nexport default () => null;",
      },
    };
    expect(stripAnsi(eventLine(write) ?? "")).toBe(
      "✓ write src/pages/Home.jsx +3 lines",
    );
    expect(
      stripAnsi(eventLine(write, undefined, { verbose: true }) ?? ""),
    ).toBe(
      "✓ write src/pages/Home.jsx +3 lines\n  import React;\n  \n  export default () => null;",
    );
  });

  it("keeps errors whole up to a fold, and folds long ok results to one line", () => {
    const failed = eventLine({
      kind: "tool_end",
      id: "b1",
      name: "run_shell_command",
      label: "",
      summary: "npm test",
      ok: false,
      result: "FAIL src/a.test.js\n  expected 1\n  received 2\n\n1 test failed",
    });
    expect(stripAnsi(failed ?? "")).toBe(
      "✗ bash npm test\n  FAIL src/a.test.js\n    expected 1\n    received 2\n  \n  1 test failed",
    );
    const chatty = eventLine(
      {
        kind: "tool_end",
        id: "b2",
        name: "run_shell_command",
        label: "",
        summary: "ls",
        ok: true,
        result: "a.js\nb.js\nc.js",
      },
      undefined,
      { foldHint: "--verbose shows everything" },
    );
    expect(stripAnsi(chatty ?? "")).toBe(
      "✓ bash ls\n  a.js … +2 lines (--verbose shows everything)",
    );
  });

  it("draws a running tool in place with a pulsing dot and its detail", () => {
    const start = {
      kind: "tool_start" as const,
      id: "r1",
      name: "run_shell_command",
      label: "Running the tests",
      summary: "npm test",
    };
    const t0 = 1_000_000;
    // The pulse is a colour change, so give chalk colours (tests run without a TTY).
    const level = chalk.level;
    chalk.level = 3;
    const lit = runningLine(start, t0 - 4_000, t0);
    const dim = runningLine(start, t0 - 3_500, t0 + 500); // same elapsed, other pulse phase
    chalk.level = level;
    expect(stripAnsi(lit)).toBe("● Running the tests · 4s\n  └ bash: npm test");
    expect(lit).not.toBe(dim); // the dot pulses
    expect(stripAnsi(dim)).toBe(stripAnsi(lit));
    expect(stripAnsi(renderEntry({ running: start, startedAt: t0 }))).toContain(
      "Running the tests",
    );
  });

  it("the thinking glyph pulses forward and back over time", () => {
    const frames = Array.from({ length: 10 }, (_, i) => shimmer(i * 120));
    expect(frames).toEqual(["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"]);
    expect(shimmer(10 * 120)).toBe("·");
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

describe("hardWrapAnsi", () => {
  it("wraps at visible width and keeps style continuity across breaks", async () => {
    const { hardWrapAnsi } = await import("@/cli/commands/code/render.js");
    // Raw codes, not chalk — chalk is color-disabled under a non-TTY test run.
    const dim = "\u001b[2m";
    const reset = "\u001b[0m";
    const wrapped = hardWrapAnsi(`${dim}${"x".repeat(10)}${reset}`, 4);
    expect(wrapped.map((l) => stripAnsi(l))).toEqual(["xxxx", "xxxx", "xx"]);
    // Continuation lines reopen the dim code so the style survives the break.
    expect(wrapped[1].startsWith(dim)).toBe(true);
    expect(wrapped[0].endsWith(reset)).toBe(true);
    // Plain text with explicit newlines splits on them.
    expect(hardWrapAnsi("ab\ncd", 10)).toEqual(["ab", "cd"]);
  });
});

describe("makePasteSanitizer", () => {
  it("strips paste markers and flattens newlines to one line", async () => {
    const { makePasteSanitizer } = await import("@/cli/commands/code/paste.js");
    const sanitize = makePasteSanitizer();
    expect(sanitize("\x1b[200~line one\nline two\r\nline three\x1b[201~")).toBe(
      "line one line two line three",
    );
    // Outside a paste, everything passes through untouched (Enter stays Enter).
    expect(sanitize("abc\r")).toBe("abc\r");
  });

  it("handles markers split across chunks", async () => {
    const { makePasteSanitizer } = await import("@/cli/commands/code/paste.js");
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
