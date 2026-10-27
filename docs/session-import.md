# Session Import

**Keywords:** session, import, Claude Code, Codex, transcript, Base Code, branch, turns_gzip_base64, `base44 session import`

`base44 session import` continues a local Claude Code or Codex session in a new Base Code branch of an imported app. It is experimental: the command is registered hidden (`program.addCommand(..., { hidden: true })`) and the endpoint sits behind a server-side flag, so a 404 means the flag is off or the app is not imported.

## Layout

```
src/core/session-import/
├── transcript.ts   # line parsers, merge and caps, gzip+base64 encoding (pure)
├── sessions.ts     # finds session files and reads them, one adapter per agent
└── api.ts          # POST /api/apps/{id}/imported/session-imports
src/cli/commands/session/import.ts   # picker, confirmation, output
```

## Where sessions live

| Agent | Files | Skipped |
|-------|-------|---------|
| Claude Code | `~/.claude/projects/<escaped-cwd>/<id>.jsonl`, one level deep (`CLAUDE_CONFIG_DIR` overrides `~/.claude`) | `subagents/` dirs; `isSidechain`, `isMeta`, compaction-summary, API-error and interrupt lines |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl` (`CODEX_HOME` overrides `~/.codex`) | `exec` runs and subagent threads (non-string `source`), developer items, injected AGENTS.md and environment items |

Titles: Claude Code uses the custom title, then the generated title, then the summary. Codex reads the name from `session_index.jsonl`. Both fall back to the first prompt.

## What is sent

Only user and assistant text. `prepareTranscript` merges consecutive turns of one role (Claude Code writes one line per content block), drops leading assistant turns, clips each turn to 4,000 characters, keeps the latest 120 turns, and drops the oldest until the total is at most 100,000 characters. The server requires alternating turns that start with the user and refuses more than 100,000 characters of text.

The body is exactly `{source, source_session_id, title, turns_gzip_base64}`. `turns_gzip_base64` is `base64(gzip(JSON.stringify(turns)))`. Always send it encoded: Cloudflare's WAF answers a raw transcript that quotes shell commands with a non-JSON 403.

The response is `{branch_id, branch_name}`: 201 when it creates a branch, 200 for an identical replay.

## Rules

- Session files are read with small type guards, not Zod: another process writes them, a torn last line is normal, and one bad line must not fail the import. The upload response is parsed with Zod.
- Cut text with `cut`, never `slice`: a lone surrogate makes the server refuse the body.
- `importSession` deletes `__requestBody` from the failed request before building the `ApiError`, so error reporting never receives the conversation. Keep that when touching `api.ts`.
- Without `--session`, the command lists sessions started in the repository (`findGitRoot`, else the working directory). `--all` lists every directory. The picker needs a TTY; non-interactive runs require `--session <id>` and `--yes`.
- `--session` looks the id up in every directory, so an agent can pass its own session id from anywhere.
- Tests plant fixtures from `tests/fixtures/sessions/` under the testkit's `HOME`, with `plant.ts`.
