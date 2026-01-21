# Base44 CLI

Command-line interface for building applications with [Base44's backend service](https://docs.base44.com/developers/backend/overview/introduction).

Base44's backend service provides a managed backend for your applications — data storage with entities, serverless functions, authentication, and hosting. The CLI lets you:

- **Create projects** from templates (backend-only or full-stack React)
- **Define entities** as JSON schemas and sync them with Base44
- **Deploy functions** written in TypeScript (Deno runtime)
- **Deploy sites** to Base44's hosting platform

## Installation

```bash
npm install -g base44
```

Requires Node.js 20.19.0 or higher.

## Quick Start

```bash
# Authenticate
base44 login

# Create a project
base44 create
```

The CLI will guide you through project setup. For step-by-step tutorials, see the quickstart guides:

- [Backend only](https://docs.base44.com/developers/backend/quickstart/quickstart-backend-only) — for headless apps or custom frontends
- [React](https://docs.base44.com/developers/backend/quickstart/quickstart-with-react) — full-stack with Vite + React

## Documentation

**[docs.base44.com/developers/references/cli](https://docs.base44.com/developers/references/cli/get-started/overview)**

## Help

```bash
base44 --help
base44 <command> --help
```

## Feedback

The CLI is in alpha. We'd love to hear from you:

- [Feature requests & feedback](https://feedback.base44.com/roadmap)
- [Report issues](https://github.com/base44/cli/issues)

## License

ISC
