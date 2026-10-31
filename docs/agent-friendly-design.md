# Agent-Friendly CLI Design

**Keywords:** non-interactive, stdin, flags, env var, secrets, idempotent, agent, automation, CI, scripting

This CLI is used by both humans and coding agents. Every command should work fully non-interactively — no prompt should be the only way to provide a value.

## Input

Every interactive prompt must have a corresponding `--flag` and environment variable equivalent so agents and CI can drive the CLI without TTY interaction.

**Rules:**

- If the user supplies *some* flags but not all required values, prompt only for the missing ones — don't restart from scratch.
- For commands that accept complex input (multiple fields), support `--from-stdin` to read a JSON blob from stdin. This lets agents pipe structured data without escaping shell arguments.
- See [commands.md](commands.md) for the existing `CLIContext.isNonInteractive` pattern that detects non-TTY environments.

**Example:**

```bash
# Fully interactive
base44 create

# Partially non-interactive — only prompts for missing values
base44 create --name my-app

# Fully non-interactive
base44 create --name my-app --template blank

# JSON blob via stdin
echo '{"name":"my-app","template":"blank"}' | base44 create --from-stdin
```

## Secrets

Secrets (API keys, tokens) should support multiple delivery methods with a clear precedence chain:

```
--secret-stdin  →  --secret <value>  →  --secret-file <path>  →  env var  →  interactive prompt
```

- **`--secret-stdin`** — Safest: reads from stdin, never appears in `ps` output or shell history.
- **`--secret <value>`** — Convenient for agents but visible in process listings. Acceptable in ephemeral CI environments.
- **`--secret-file <path>`** — Reads from a file path. Good for mounted secrets in containers.
- **Environment variable** — Standard for CI. Document the expected env var name in `--help`.
- **Interactive prompt** — Fallback for human users. Use `@clack/prompts` password input (masked).

Higher-precedence methods silently override lower ones — no conflict errors.

## Errors

Build on the existing error hierarchy (see [error-handling.md](error-handling.md)) with these agent-friendly additions:

### Batch Validation Errors

When a command receives multiple invalid inputs, report *all* validation failures at once rather than failing on the first one. Agents can then fix everything in a single retry.

```typescript
throw new InvalidInputError("Multiple validation errors", {
  hints: [
    { message: 'Field "name" is required', command: "base44 create --name <value>" },
    { message: 'Template "foo" not found. Valid: blank, react, vue', command: "base44 create --template blank" },
  ],
});
```

### Missing Fields Array

When required flags are missing, include them in hints so agents know exactly what to supply:

```typescript
throw new InvalidInputError("Missing required flags: --name, --template", {
  hints: [
    { message: "Provide --name and --template, or use --from-stdin with a JSON blob" },
  ],
});
```

### Partial Failure Reporting

For batch operations (e.g., deploying multiple resources), report which items succeeded and which failed rather than aborting on first failure:

```typescript
log.warn("Deployed 3/5 functions. Failed: calculate-tax, send-email");
// Then throw with hints pointing to the specific failures
```

### Remediation Hints

Every error hint should tell the agent *what to do next*, not just what went wrong. Use the `command` field in `ErrorHint` so agents can programmatically extract the fix:

```typescript
{
  message: "Auth token expired. Re-authenticate to continue.",
  command: "base44 login"
}
```

## Behavior

### Idempotency

Commands should be safe to retry. If an agent runs `base44 deploy` twice with the same inputs, the second run should succeed (or no-op) rather than fail with "already exists" errors.

- **Create commands**: Check if the resource already exists; update it or return success with a note.
- **Delete commands**: If the target is already gone, exit successfully — don't error.
- **Deploy commands**: Redeploy cleanly on repeated runs.

This lets agents use simple retry loops without special error handling for repeated operations.

## Consistency

Use the same flag names and semantics across all subcommands:

| Flag | Meaning | Used in |
|------|---------|---------|
| `--name` | Resource name | All creation commands |
| `--app-id` | Target application | All app-scoped commands |
| `--format` | Output format (json, table) | All list/get commands |
| `--from-stdin` | Read JSON input from stdin | All commands with complex input |
| `--yes` / `-y` | Skip confirmation prompts | All destructive commands |
| `--quiet` / `-q` | Suppress non-essential output | All commands |

When adding a new command, check sibling commands for flag naming conventions before introducing new flag names.

## Discoverability

Every command and flag must have thorough `--help` output:

- **Description**: One sentence explaining what the command does.
- **Examples**: At least one example showing common usage, one showing non-interactive usage.
- **Flag defaults**: Show default values in flag descriptions.
- **Environment variables**: Document which env vars are accepted (e.g., `BASE44_API_KEY`).

Agents rely on `--help` to discover how to use commands. If a flag isn't documented, it doesn't exist from the agent's perspective.
