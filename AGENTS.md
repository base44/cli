# AI Agent Guidelines for Base44 CLI Development

This document provides essential context and guidelines for AI agents working on the Base44 CLI project.

**Important**: Keep this file updated when making significant architectural changes.

## Project Overview

The Base44 CLI is a TypeScript-based command-line tool built with:
- **oclif** - CLI framework by Salesforce (command parsing, help generation, plugins)
- **@clack/prompts** - Interactive user prompts and UI components
- **Zod** - Schema validation for API responses, config files, and user inputs
- **JSON5** - Parsing JSONC/JSON5 config files (supports comments and trailing commas)
- **TypeScript** - Primary language
- **tsdown** - Bundler (powered by Rolldown)

### Distribution Strategy
The CLI is distributed as a **minimal dependency package**. All code except `@oclif/core` is bundled into a single JavaScript file:
- tsdown bundles everything to `dist/index.js` (~750KB)
- Uses oclif's **explicit command discovery strategy** (commands exported from entry file)
- Only `@oclif/core` is a runtime dependency (kept external for oclif compatibility)
- Faster install times and smaller node_modules

### Project Structure
- **Package**: `base44` - Single package published to npm
- **Core Module**: `src/core/` - Resources, utilities, errors, and config
- **CLI Module**: `src/cli/` - CLI commands, base command, and utilities

## Folder Structure

```
cli/
├── bin/
│   ├── run.js           # Production entry point
│   ├── run.cmd          # Windows production
│   ├── dev.js           # Development entry point (tsx)
│   └── dev.cmd          # Windows development
├── src/
│   ├── core/
│   │   ├── clients/             # HTTP clients
│   │   │   ├── oauth-client.ts  # Unauthenticated client for login flow
│   │   │   ├── base44-client.ts # Authenticated client with token refresh
│   │   │   └── index.ts
│   │   ├── auth/                # User authentication
│   │   │   ├── api.ts           # OAuth API calls
│   │   │   ├── schema.ts        # Auth Zod schemas
│   │   │   ├── config.ts        # Token storage/refresh
│   │   │   └── index.ts
│   │   ├── project/             # Project configuration
│   │   │   ├── config.ts        # Project loading logic
│   │   │   ├── schema.ts        # Project/template schemas
│   │   │   ├── api.ts           # Project creation API
│   │   │   ├── create.ts        # Project scaffolding
│   │   │   ├── template.ts      # Template rendering
│   │   │   └── index.ts
│   │   ├── resources/           # Project resources (entity, function, etc.)
│   │   │   ├── types.ts         # Resource<T> interface
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
│   │   ├── site/                # Site deployment (NOT a Resource)
│   │   │   ├── schema.ts        # DeployResponse Zod schema
│   │   │   ├── config.ts        # getSiteFilePaths() - glob files for validation
│   │   │   ├── api.ts           # uploadSite() - reads archive, sends to API
│   │   │   ├── deploy.ts        # deploySite() - validates, creates tar.gz, uploads
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   ├── fs.ts            # File system utilities
│   │   │   └── index.ts
│   │   ├── consts.ts            # Pure constants (NO imports from other core modules)
│   │   ├── config.ts            # Path helpers and env loading
│   │   ├── errors.ts            # Error classes
│   │   └── index.ts             # Barrel export for all core modules
│   └── cli/
│       ├── commands/            # oclif commands (discovered by file path)
│       │   ├── login.ts         # base44 login
│       │   ├── logout.ts        # base44 logout
│       │   ├── whoami.ts        # base44 whoami
│       │   ├── create.ts        # base44 create
│       │   ├── entities/
│       │   │   └── push.ts      # base44 entities push
│       │   └── site/
│       │       └── deploy.ts    # base44 site deploy
│       ├── hooks/
│       │   └── prerun.ts        # Prerun hook (banner, env, auth)
│       ├── lib/
│       │   ├── base-command.ts  # Base class with static config properties
│       │   ├── logger.ts        # Custom oclif logger using @clack/prompts
│       │   ├── run-task.ts      # Spinner wrapper
│       │   ├── banner.ts        # ASCII art banner
│       │   ├── prompts.ts       # Prompt utilities
│       │   └── index.ts
│       └── index.ts             # Entry point - exports COMMANDS and hooks
├── templates/                   # Project templates
├── tests/
├── dist/
│   └── index.js                 # Bundled output (single file)
├── tsdown.config.mjs            # tsdown bundler config
├── package.json
└── tsconfig.json
```

## Adding a New Command

Commands live in `src/cli/commands/`. oclif discovers commands by file path:
- `src/cli/commands/foo.ts` → `base44 foo`
- `src/cli/commands/foo/bar.ts` → `base44 foo bar`

### 1. Create the command file

```typescript
// src/cli/commands/<name>.ts (or <topic>/<name>.ts for nested)
import { log } from "@clack/prompts";
import { BaseCommand } from "../lib/base-command.js";
import { runTask } from "../lib/run-task.js";

export default class MyCommand extends BaseCommand {
  static override description = "What this command does";
  static override examples = ["<%= config.bin %> mycommand"];

  // Set these static properties to customize behavior
  static override requiresAuth = false;  // Set to true if auth required
  static override showFullBanner = false; // Set to true for ASCII banner

  async run(): Promise<void> {
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
}
```

### 2. Command with flags and args

```typescript
import { Flags, Args } from "@oclif/core";
import { BaseCommand } from "../lib/base-command.js";

export default class MyCommand extends BaseCommand {
  static override description = "Command with options";

  static override flags = {
    force: Flags.boolean({ char: "f", description: "Force the operation" }),
    name: Flags.string({ char: "n", description: "Name to use", required: true }),
  };

  static override args = {
    file: Args.string({ description: "File to process", required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MyCommand);
    // Use args.file, flags.force, flags.name
  }
}
```

### 3. BaseCommand and the Prerun Hook

The `BaseCommand` class provides static properties that are read by the `prerun` hook:

**BaseCommand static properties:**
- `requiresAuth` - Set to true if the command requires authentication
- `showFullBanner` - Set to true to show full ASCII art banner

**The prerun hook (`src/cli/hooks/prerun.ts`) handles:**
- Displaying the Base44 intro banner (or full ASCII art)
- Loading `.env.local` from project root
- Checking authentication if required

This separation follows oclif best practices - hooks handle cross-cutting concerns.

```typescript
// Standard command with simple intro tag
static override requiresAuth = false;
static override showFullBanner = false;

// Command requiring authentication
static override requiresAuth = true;

// Command with full ASCII art banner (for special commands like create)
static override showFullBanner = true;
static override requiresAuth = true;
```

## Making API Calls

Use the HTTP clients from `src/core/clients/index.js`:

### Authenticated API calls (most common)

```typescript
import { base44Client, getAppClient } from "../../core/clients/index.js";

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
import { oauthClient } from "../../core/clients/index.js";

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
import { deploySite } from "../../core/site/index.js";

// Deploy site from output directory (returns deployment details)
const { app_url, files_count } = await deploySite("./dist");
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

## Hooks

oclif hooks are used for cross-cutting concerns. Hooks are registered in `package.json` under `oclif.hooks`.

### Prerun Hook (`src/cli/hooks/prerun.ts`)

Runs after the command is found but before execution. Handles:
- Displaying the Base44 banner (reads `showFullBanner` from command)
- Loading project environment variables (`.env.local`)
- Authentication checks (reads `requiresAuth` from command)

```typescript
// The hook reads these static properties from the command class:
static requiresAuth = true;
static showFullBanner = false;
```

### Adding a New Hook

1. Create the hook file in `src/cli/hooks/<event>.ts`
2. Export it from `src/cli/index.ts`:
   ```typescript
   import myHook from "./hooks/my-hook.js";
   export const MY_HOOK = myHook;
   ```
3. Register in `package.json` under `oclif.hooks`:
   ```json
   "hooks": {
     "prerun": {
       "target": "./dist/index.js",
       "identifier": "PRERUN_HOOK"
     }
   }
   ```

Available lifecycle events: `init`, `prerun`, `postrun`, `command_not_found`, `finally`

## Important Rules

1. **npm only** - Never use yarn
2. **Zod validation** - Required for all external data (API responses, config files)
3. **@clack/prompts** - For all user interaction (prompts, spinners, logs)
4. **ES Modules** - Use `.js` extensions in imports
5. **Cross-platform** - Use `path` module utilities, never hardcode separators
6. **BaseCommand** - All commands extend `BaseCommand` from `lib/base-command.js`
7. **runTask** - Use `runTask()` for async operations with spinners
8. **consts.ts has no imports** - Keep `consts.ts` dependency-free to avoid circular deps
9. **Keep AGENTS.md updated** - Update this file when architecture changes
10. **Relative imports in core/** - Use relative paths (not `@core/`) for imports within core modules
11. **Default exports for commands** - oclif requires commands to use `export default class`

## Development

```bash
npm run build      # tsdown - bundles to single file dist/index.js
npm run typecheck  # tsc --noEmit - type checking only
npm run dev        # Run CLI in development mode (auto-transpiles)
npm test           # vitest
npm run lint       # eslint
```

### Running commands in development

```bash
./bin/dev.js --help
./bin/dev.js login
./bin/dev.js create
./bin/dev.js entities push
```

### Running commands in production (after build)

```bash
./bin/run.js --help
./bin/run.js login
```

### Node.js Version

This project requires Node.js >= 20.19.0. A `.node-version` file is provided for fnm/nodenv.

## oclif Configuration

The oclif configuration uses the **explicit strategy** for bundling compatibility:

```json
{
  "oclif": {
    "bin": "base44",
    "dirname": "base44",
    "commands": {
      "strategy": "explicit",
      "target": "./dist/index.js",
      "identifier": "COMMANDS"
    },
    "hooks": {
      "prerun": {
        "target": "./dist/index.js",
        "identifier": "PRERUN_HOOK"
      }
    },
    "topicSeparator": " "
  }
}
```

- `strategy: "explicit"` - Commands are exported from entry file, not discovered by path
- `target` - Path to the bundled file
- `identifier` - Name of the export (COMMANDS object or hook function)
- `topicSeparator` - Use space instead of colon (e.g., `entities push` not `entities:push`)

### Adding a New Command

When adding a new command, you must:
1. Create the command file in `src/cli/commands/`
2. Import and add it to `COMMANDS` in `src/cli/index.ts`:
   ```typescript
   import MyCommand from "./commands/my-command.js";

   export const COMMANDS = {
     // ... existing commands
     "my-command": MyCommand,
   };
   ```

## File Locations

- `cli/AGENTS.md` - This file
- `cli/src/core/` - Core module
- `cli/src/cli/commands/` - CLI commands
- `cli/src/cli/lib/` - CLI utilities (BaseCommand, logger, etc.)
- `cli/src/cli/index.ts` - Entry point (exports COMMANDS and hooks)
- `cli/bin/` - Entry point scripts
- `cli/tsdown.config.mjs` - Bundler configuration
- `cli/.node-version` - Node.js version pinning
