# AI Agent Guidelines for Base44 CLI Development

This document provides essential context and guidelines for AI agents working on the Base44 CLI project.

**Important**: Keep this file updated when making significant architectural changes.

## Project Overview

The Base44 CLI is a TypeScript-based command-line tool built with:
- **Commander.js** - CLI framework for command parsing
- **@clack/prompts** - Interactive user prompts and UI components
- **Zod** - Schema validation for API responses, config files, and user inputs
- **JSON5** - Parsing JSONC/JSON5 config files (supports comments and trailing commas)
- **TypeScript** - Primary language
- **tsdown** - Bundler (powered by Rolldown, the Rust-based Rollup successor)

### Distribution Strategy
The CLI is distributed as a **zero-dependency package**. All runtime dependencies are bundled into a single JavaScript file. This means:
- Users only download the bundled code 
- No dependency resolution or node_modules installation
- Faster install times and no version conflicts

### Project Structure
- **Package**: `base44` - Single package published to npm
- **Core Module**: `src/core/` - Resources, utilities, errors, and config
- **CLI Module**: `src/cli/` - CLI commands and entry point

## Folder Structure

```
cli/
├── src/
│   ├── core/
│   │   ├── api/                  # HTTP clients
│   │   │   ├── oauth-client.ts   # Unauthenticated client for login flow
│   │   │   ├── base44-client.ts  # Authenticated client with token refresh
│   │   │   └── index.ts
│   │   ├── auth/                 # User authentication
│   │   │   ├── api.ts            # OAuth API calls
│   │   │   ├── schema.ts         # Auth Zod schemas
│   │   │   ├── config.ts         # Token storage/refresh
│   │   │   └── index.ts
│   │   ├── project/              # Project configuration
│   │   │   ├── config.ts         # Project loading logic
│   │   │   ├── schema.ts         # Project/template schemas
│   │   │   ├── api.ts            # Project creation API
│   │   │   ├── create.ts         # Project scaffolding
│   │   │   ├── template.ts       # Template rendering
│   │   │   └── index.ts
│   │   ├── resources/            # Project resources (entity, function, etc.)
│   │   │   ├── types.ts          # Resource<T> interface
│   │   │   ├── entity/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── resource.ts
│   │   │   │   ├── api.ts
│   │   │   │   └── index.ts
│   │   │   ├── function/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── resource.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── site/                 # Site deployment (NOT a Resource)
│   │   │   ├── schema.ts         # DeployResponse Zod schema
│   │   │   ├── config.ts         # getSiteFilePaths() - glob files for validation
│   │   │   ├── api.ts            # uploadSite() - reads archive, sends to API
│   │   │   ├── deploy.ts         # deploySite() - validates, creates tar.gz, uploads
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   ├── fs.ts             # File system utilities
│   │   │   └── index.ts
│   │   ├── consts.ts             # Pure constants (NO imports from other core modules)
│   │   ├── config.ts             # Path helpers and env loading
│   │   ├── errors.ts             # Error classes
│   │   └── index.ts              # Barrel export for all core modules
│   └── cli/
│       ├── commands/
│       │   ├── auth/
│       │   │   ├── login.ts
│       │   │   ├── logout.ts
│       │   │   └── whoami.ts
│       │   ├── project/
│       │   │   └── create.ts
│       │   └── entities/
│       │       └── push.ts
│       │   └── site/
│       │       └── deploy.ts
│       ├── utils/
│       │   ├── runCommand.ts     # Command wrapper with branding
│       │   ├── runTask.ts        # Spinner wrapper
│       │   ├── banner.ts         # ASCII art banner
│       │   ├── prompts.ts        # Prompt utilities
│       │   └── index.ts
│       └── index.ts              # CLI entry point
├── templates/                    # Project templates
├── tests/
├── dist/
├── package.json
└── tsconfig.json
```

## Adding a New Command

Commands live in `src/cli/commands/`. Follow these steps:

### 1. Create the command file

```typescript
// src/cli/commands/<domain>/<action>.ts
import { Command } from "commander";
import { log } from "@clack/prompts";
import { runCommand, runTask } from "../../utils/index.js";

async function myAction(): Promise<void> {
  // Use runTask for async operations with spinners
  const result = await runTask(
    "Doing something...",
    async () => {
      // Your async operation here
      return someResult;
    },
    {
      successMessage: "Done!",
      errorMessage: "Failed to do something",
    }
  );

  log.success("Operation completed!");
}

export const myCommand = new Command("<name>")
  .description("<description>")
  .option("-f, --flag", "Some flag")
  .action(async (options) => {
    await runCommand(myAction);
  });
```

### 2. Register in CLI entry point

```typescript
// src/cli/index.ts
import { myCommand } from "./commands/<domain>/<action>.js";

// ...
program.addCommand(myCommand);
```

### 3. Command wrapper options

```typescript
// Standard command with simple intro tag
await runCommand(myAction);

// Command with full ASCII art banner (for special commands like create)
await runCommand(myAction, { fullBanner: true });

// Command requiring authentication
await runCommand(myAction, { requireAuth: true });

// Command with multiple options
await runCommand(myAction, { fullBanner: true, requireAuth: true });
```

## Making API Calls

Use the HTTP clients from `@core/api/index.js`:

### Authenticated API calls (most common)

```typescript
import { base44Client, getAppClient } from "@core/api/index.js";

// For general Base44 API calls
const response = await base44Client.get("api/endpoint");
const data = await response.json();

// For app-specific API calls (requires BASE44_CLIENT_ID env var)
const appClient = getAppClient();
const response = await appClient.get("entities");
const entities = await response.json();

// POST with JSON body
const response = await base44Client.post("api/endpoint", {
  json: { key: "value" },
});
```

### OAuth endpoints (login flow only)

```typescript
import { oauthClient } from "@core/api/index.js";

// Used only in auth/api.ts for device code flow
const response = await oauthClient.post("oauth/device/code", {
  json: { client_id: AUTH_CLIENT_ID, scope: "apps:read apps:write" },
});
```

### Token refresh

The `base44Client` automatically handles token refresh:
1. Before each request, checks if token is expired
2. If expired, refreshes token and saves new tokens
3. On 401 response, attempts refresh and retries once

## Resource Pattern

Resources are project-specific collections (entities, functions) that can be loaded from the filesystem.

### Resource Interface (`resources/types.ts`)

```typescript
export interface Resource<T> {
  readAll: (dir: string) => Promise<T[]>;
  push?: (items: T[]) => Promise<unknown>;
}
```

### Resource Implementation (`resources/<name>/resource.ts`)

```typescript
export const entityResource: Resource<Entity> = {
  readAll: readAllEntities,
  push: pushEntities,
};
```

### Adding a New Resource

1. Create folder in `src/core/resources/<name>/`
2. Add `schema.ts` with Zod schemas
3. Add `config.ts` with file reading logic
4. Add `resource.ts` implementing `Resource<T>`
5. Add `api.ts` for API calls (if needed)
6. Add `index.ts` barrel exports
7. Update `resources/index.ts` to export the new resource
8. Register in `project/config.ts` (add to `readProjectConfig`)
9. Add typed field to `ProjectData` interface

## Site Module

The site module (`src/core/site/`) handles deploying built frontend files to Base44 hosting. Unlike Resources, the site module:

- Reads built artifacts (JS, CSS, HTML) from the output directory
- Gets configuration from `site.outputDirectory` in project config
- Creates a tar.gz archive and uploads it to the API

### Architecture

```
site/
├── schema.ts    # DeployResponse Zod schema
├── config.ts    # getSiteFilePaths() - glob files for validation
├── api.ts       # uploadSite() - reads archive, sends to API
├── deploy.ts    # deploySite() - validates, creates archive, uploads
└── index.ts     # Barrel exports
```

### Key Functions

```typescript
import { deploySite } from "@core/site/index.js";

// Deploy site from output directory (returns deployment details)
const { appUrl } = await deploySite("./dist");
```

### Deploy Flow

1. Validate output directory exists and has files
2. Create temporary tar.gz archive using `tar` package
3. Upload archive to `POST /api/apps/{app_id}/deploy-dist`
4. Parse response with Zod schema
5. Clean up temporary archive file

### CLI Command

```bash
base44 site deploy
```

## Path Aliases

Single alias defined in `tsconfig.json`:
- `@core/*` → `./src/core/*`

```typescript
import { readProjectConfig } from "@core/project/index.js";
import { entityResource } from "@core/resources/entity/index.js";
import { base44Client } from "@core/api/index.js";
```

## Important Rules

1. **npm only** - Never use yarn
2. **Zod validation** - Required for all external data (API responses, config files)
3. **@clack/prompts** - For all user interaction (prompts, spinners, logs)
4. **ES Modules** - Use `.js` extensions in imports
5. **Cross-platform** - Use `path` module utilities, never hardcode separators
6. **Command wrapper** - All commands use `runCommand()` utility
7. **Task wrapper** - Use `runTask()` for async operations with spinners
8. **consts.ts has no imports** - Keep `consts.ts` dependency-free to avoid circular deps
9. **Keep AGENTS.md updated** - Update this file when architecture changes
10. **Zero-dependency distribution** - All packages go in `devDependencies`; they get bundled at build time

## Development

```bash
npm run build      # tsdown - bundles to single file in dist/cli/index.js
npm run typecheck  # tsc --noEmit - type checking only
npm run dev        # tsx for development
npm test           # vitest
npm run lint       # eslint
```

### Node.js Version

This project requires Node.js >= 20.19.0. A `.node-version` file is provided for fnm/nodenv.

## File Locations

- `cli/plan.md` - Implementation plan
- `cli/AGENTS.md` - This file
- `cli/src/core/` - Core module
- `cli/src/cli/` - CLI commands
- `cli/tsdown.config.mjs` - Build configuration
- `cli/.node-version` - Node.js version pinning
