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
| [`deploy`](https://docs.base44.com/developers/references/cli/commands/deploy) | Deploy resources and site to Base44 |
| [`link`](https://docs.base44.com/developers/references/cli/commands/link) | Link a local project to a project on Base44 |
| [`dashboard`](https://docs.base44.com/developers/references/cli/commands/dashboard) | Open the app dashboard in your browser |
| [`login`](https://docs.base44.com/developers/references/cli/commands/login) | Authenticate with Base44 |
| [`logout`](https://docs.base44.com/developers/references/cli/commands/logout) | Sign out and clear stored credentials |
| [`whoami`](https://docs.base44.com/developers/references/cli/commands/whoami) | Display the current authenticated user |
| [`entities push`](https://docs.base44.com/developers/references/cli/commands/entities-push) | Push local entity schemas to Base44 |
| [`functions deploy`](https://docs.base44.com/developers/references/cli/commands/functions-deploy) | Deploy local functions to Base44 |
| [`site deploy`](https://docs.base44.com/developers/references/cli/commands/site-deploy) | Deploy built site files to Base44 hosting |


<!--| [`eject`](https://docs.base44.com/developers/references/cli/commands/eject) | Create a Base44 backend project from an existing Base44 app | -->

## Help

```bash
base44 --help
base44 <command> --help
```

## Version

```bash
base44 --version
```

## Alpha

The CLI and Base44 backend service are currently in alpha. We're actively improving them based on user feedback. Share your thoughts and feature requests on our [GitHub Discussions](https://github.com/orgs/base44/discussions).

Found a bug? [Open an issue](https://github.com/base44/cli/issues).

## License

ISC
