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
| [`connectors pull`](https://docs.base44.com/developers/references/cli/commands/connectors-pull) | Pull connectors from Base44 to local files |
| [`connectors push`](https://docs.base44.com/developers/references/cli/commands/connectors-push) | Push local connectors to Base44 |
| [`entities push`](https://docs.base44.com/developers/references/cli/commands/entities-push) | Push local entities to Base44 |
| [`functions deploy`](https://docs.base44.com/developers/references/cli/commands/functions-deploy) | Deploy local functions to Base44 |
| [`site deploy`](https://docs.base44.com/developers/references/cli/commands/site-deploy) | Deploy built site files to Base44 hosting |
| [`site open`](https://docs.base44.com/developers/references/cli/commands/site-open) | Open the published site in your browser |
| [`types generate`](https://docs.base44.com/developers/references/cli/commands/types-generate) | Generate TypeScript types from project resources |

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
