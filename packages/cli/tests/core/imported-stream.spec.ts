import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/core/resources/imported/api.js";
import {
  newStreamState,
  renderConversationDelta,
} from "@/core/resources/imported/stream.js";

const assistant = (
  overrides: Partial<ConversationMessage> & { id: string },
): ConversationMessage => ({
  role: "assistant",
  content: null,
  ...overrides,
});

describe("renderConversationDelta", () => {
  it("prints each item once across polls: announce, then settle, then nothing", () => {
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

    const first = renderConversationDelta(state, [running]);
    expect(first).toEqual([
      "✻ Choosing FastAPI.",
      '→ run_shell_command  {"command": "docker compose up -d"}',
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
    const second = renderConversationDelta(state, [settled]);
    expect(second).toEqual([
      "The stack is up.",
      "✓ run_shell_command — 3 containers started",
    ]);

    expect(renderConversationDelta(state, [settled])).toEqual([]);
  });

  it("prints only the newly appended part of growing text", () => {
    const state = newStreamState();
    renderConversationDelta(state, [
      assistant({ id: "m1", content: "Scaffolding the backend." }),
    ]);
    const delta = renderConversationDelta(state, [
      assistant({
        id: "m1",
        content: "Scaffolding the backend. Now the frontend.",
      }),
    ]);
    expect(delta).toEqual(["Now the frontend."]);
  });

  it("marks a failed tool distinctly and flattens structured results", () => {
    const state = newStreamState();
    const lines = renderConversationDelta(state, [
      assistant({
        id: "m1",
        tool_calls: [
          {
            id: "t1",
            name: "edit_repo_file",
            arguments_string: null,
            status: "error",
            results: { error: "File not found" },
          },
        ],
      }),
    ]);
    expect(lines).toEqual([
      "→ edit_repo_file",
      '✗ edit_repo_file — {"error":"File not found"}',
    ]);
  });

  it("ignores user and hidden messages", () => {
    const state = newStreamState();
    const lines = renderConversationDelta(state, [
      { id: "u1", role: "user", content: "add login" },
      assistant({ id: "h1", hidden: true, content: "internal" }),
    ]);
    expect(lines).toEqual([]);
  });

  it("a primed state suppresses history but streams what comes after", () => {
    const state = newStreamState();
    const history = assistant({ id: "m0", content: "Earlier turn summary." });
    renderConversationDelta(state, [history]); // prime
    const lines = renderConversationDelta(state, [
      history,
      assistant({ id: "m1", content: "New turn begins." }),
    ]);
    expect(lines).toEqual(["New turn begins."]);
  });
});
