# Base44 CLI

Command-line interface for building applications with [Base44's backend service](https://docs.base44.com/developers/backend/overview/introduction).

Base44's backend service provides a managed backend for your applications, including data storage with entities, serverless functions, authentication, and hosting. The CLI lets you:

- **Create projects** from templates.
- **Sync** resources defined in local code with your Base44 backend.
- **Deploy sites** to Base44's hosting platform.

To get started, see the full list of commands below or check out the [documentation](https://docs.base44.com/developers/references/cli/get-started/overview).

## Installation

```bash
npm install -g base44
```

Or run commands directly with npx:

```bash
npx base44 <command>
```

Requires Node.js 20.19.0 or higher.

## Quick start

```bash
# Authenticate
base44 login

# Create a project
base44 create
```

The CLI will guide you through project setup. For step-by-step tutorials, see the quickstart guides:

- [Backend only](https://docs.base44.com/developers/backend/quickstart/quickstart-backend-only) — for headless apps or custom frontends
- [React](https://docs.base44.com/developers/backend/quickstart/quickstart-with-react) — full-stack with Vite + React

## Commands

| Command | Description |
| ------- | ----------- |
| [`create`](https://docs.base44.com/developers/references/cli/commands/create) | Create a new Base44 project from a template |
| [`deploy`](https://docs.base44.com/developers/references/cli/commands/deploy) | Deploy all project resources and site to Base44 |
| [`eject`](https://docs.base44.com/developers/references/cli/commands/eject) | Download the code for an existing Base44 project |
| [`link`](https://docs.base44.com/developers/references/cli/commands/link) | Link a local project to a Base44 project |
| [`dashboard open`](https://docs.base44.com/developers/references/cli/commands/dashboard) | Open the app dashboard in your browser |
| [`login`](https://docs.base44.com/developers/references/cli/commands/login) | Authenticate with Base44 |
| [`logout`](https://docs.base44.com/developers/references/cli/commands/logout) | Sign out and clear stored credentials |
| [`whoami`](https://docs.base44.com/developers/references/cli/commands/whoami) | Display the current authenticated user |
| [`agents pull`](https://docs.base44.com/developers/references/cli/commands/agents-pull) | Pull agents from Base44 to local files |
| [`agents push`](https://docs.base44.com/developers/references/cli/commands/agents-push) | Push local agents to Base44 |
| [`connectors initiate`](https://docs.base44.com/developers/references/cli/commands/connectors-initiate) | Initialize a connector on an app and start its OAuth flow |
| [`connectors pull`](https://docs.base44.com/developers/references/cli/commands/connectors-pull) | Pull connectors from Base44 to local files |
| [`connectors push`](https://docs.base44.com/developers/references/cli/commands/connectors-push) | Push local connectors to Base44 |
| [`entities push`](https://docs.base44.com/developers/references/cli/commands/entities-push) | Push local entities to Base44 |
| [`functions deploy`](https://docs.base44.com/developers/references/cli/commands/functions-deploy) | Deploy local functions to Base44 |
| [`secrets list`](https://docs.base44.com/developers/references/cli/commands/secrets-list) | List project secret names |
| [`secrets set`](https://docs.base44.com/developers/references/cli/commands/secrets-set) | Set one or more project secrets |
| [`secrets delete`](https://docs.base44.com/developers/references/cli/commands/secrets-delete) | Delete a project secret |
| [`sandbox ls`](https://docs.base44.com/developers/references/cli/commands/sandbox-ls) | List directory entries in an app's remote sandbox |
| [`sandbox read`](https://docs.base44.com/developers/references/cli/commands/sandbox-read) | Read file contents from an app's remote sandbox |
| [`sandbox write`](https://docs.base44.com/developers/references/cli/commands/sandbox-write) | Create or overwrite a file in an app's remote sandbox |
| [`sandbox edit`](https://docs.base44.com/developers/references/cli/commands/sandbox-edit) | Apply exact old→new string edits to a file in the sandbox |
| [`sandbox grep`](https://docs.base44.com/developers/references/cli/commands/sandbox-grep) | Search files for a pattern in an app's remote sandbox |
| [`sandbox run`](https://docs.base44.com/developers/references/cli/commands/sandbox-run) | Run a shell command in an app's remote sandbox |
| [`sandbox checkpoint`](https://docs.base44.com/developers/references/cli/commands/sandbox-checkpoint) | Create a restore-point checkpoint of an app's remote sandbox |
| [`site deploy`](https://docs.base44.com/developers/references/cli/commands/site-deploy) | Deploy built site files to Base44 hosting |
| [`site open`](https://docs.base44.com/developers/references/cli/commands/site-open) | Open the published site in your browser |
| [`types generate`](https://docs.base44.com/developers/references/cli/commands/types-generate) | Generate TypeScript types from project resources |

## Global flags

These work with any command:

| Flag | Description |
| ---- | ----------- |
| `--app-id <id>` | Target a Base44 app explicitly (overrides the linked project and `BASE44_APP_ID`) |
| `--json` | Emit machine-readable JSON to stdout and run in silent mode |

### `--json`

Use `--json` for scripting and agent automation:

- **stdout is a single JSON document** — pipe it straight into `jq`.
- **Silent mode** — interactive prompts, the spinner, and human status lines are suppressed; all status and diagnostics go to **stderr**, so stdout stays pure JSON.
- **Errors are JSON too** — a failure prints `{ "error": "...", "code": "...", "hints": [...] }` to stdout and exits non-zero, so you can parse success and failure from the same stream.
- **Every command accepts it.** Commands with structured output (e.g. `sandbox`, `connectors`) return rich JSON; others fall back to `{ "output": "<status>" }`.

```bash
# Pure JSON on stdout, ready for jq
base44 sandbox ls src --app-id app_123 --json | jq '.entries'
base44 sandbox run "npm test" --app-id app_123 --json | jq '.exitCode'
```

## AI agent skills

When creating a project, [base44/skills](https://github.com/base44/skills) are automatically installed. These help AI agents understand how to work with Base44 projects.

If you need to install skills manually, use the following command:

```bash
npx skills add base44/skills
```

## Help

```bash
base44 --help
base44 <command> --help
```

## Version

```bash
base44 --version
```

## Beta

The CLI and Base44 backend service are currently in beta. We're actively improving them based on user feedback. Share your thoughts and feature requests on our [GitHub Discussions](https://github.com/orgs/base44/discussions).

Found a bug? [Open an issue](https://github.com/base44/cli/issues).

## License

MIT
