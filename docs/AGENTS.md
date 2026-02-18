# Base44 CLI

The Base44 CLI (`base44` npm package) is a TypeScript command-line tool for creating, managing, and deploying Base44 apps from the terminal.

## Tech Stack

- **Bun** - Runtime, bundler, and package manager (use `bun`, never npm/yarn)
- **Commander.js** - CLI framework for command parsing
- **@clack/prompts** - Interactive user prompts, spinners, and logs
- **Zod** - Schema validation for all external data (API responses, config files, user input)
- **JSON5** - Parsing JSONC/JSON5 config files (supports comments and trailing commas)
- **TypeScript** - Primary language, strict types
- **Biome** - Linting and formatting (replaces ESLint)
- **Vitest** - Test runner

## Architecture

The codebase has two layers with a clear separation of concerns:

- **`src/core/`** - SDK layer: pure business logic with no UI or CLI concerns. Handles resources, auth, API clients, project config, site deployment, error classes, and utilities.
- **`src/cli/`** - Presentation layer: CLI commands, user interaction, theming, telemetry, and wiring. Depends on `core/`, never the reverse.
- **`bin/`** - Entry points: `run.js` (production, Node.js) and `dev.ts` (development, Bun runs TypeScript directly).
- **`templates/`** - Project scaffolding templates for `base44 create`.
- **`tests/`** - CLI integration tests (`cli/`), core unit tests (`core/`), and test fixtures (`fixtures/`).

```
src/
├── core/           # SDK: auth, clients, project, resources (entity/function/agent/connector), site, errors, utils
└── cli/            # UI: commands, telemetry, utils (runCommand, runTask, theme, banner)
```

### Distribution

Zero-dependency npm package. All runtime dependencies are bundled into `dist/index.js` at build time. Every dependency goes in `devDependencies`. Users only download the bundled code.

### Path Alias

`@/*` resolves to `./src/*` (defined in `tsconfig.json`). Always use `.js` extensions in imports (ES Modules).

## Development Commands

```bash
bun install        # Install dependencies
bun run build      # Bundle to dist/index.js + copy templates
bun run typecheck  # tsc --noEmit
bun run dev        # Run bin/dev.ts (no build needed, Bun runs TS directly)
bun run start      # Run bin/run.js (requires build first)
bun run test       # Run tests with vitest (use `bun run test`, not `bun test`)
bun run lint       # Biome - lint and format check
bun run lint:fix   # Biome - auto-fix
```

**Prerequisites**: Bun (`curl -fsSL https://bun.sh/install | bash`), Node.js >= 20.19.0 (for npm publishing).

**Debugging**: `DEBUG=1 base44 deploy` shows full stack traces on errors.

## Rules

These apply to every task. See topic guides below for domain-specific rules.

1. **Bun for everything** - Use `bun` commands for install, test, build, run
2. **Zod validation** - Required for all external data (API responses, config files)
3. **@clack/prompts only** - For all user interaction (prompts, spinners, logs). No `console.log`
4. **ES Modules** - Use `.js` extensions in all imports
5. **Cross-platform** - Use `path` module utilities, never hardcode separators
6. **Zero-dependency distribution** - All packages go in `devDependencies`; they get bundled
7. **No dynamic imports** - Use static imports at top of file, avoid `await import()`
8. **consts.ts has no imports** - Keep `consts.ts` dependency-free to avoid circular deps
9. **Keep docs updated** - Update files in `docs/` when architecture changes

## Topic Guides

Read these when working on the relevant area:

- **[Adding or modifying CLI commands](commands.md)** - Factory pattern, `runCommand()`, `runTask()`, `CLIContext`, theming, `chalk` ban
- **[Making API calls](api-patterns.md)** - HTTP clients, Zod snake_case-to-camelCase transforms, `ApiError.fromHttpError()`
- **[Working with resources](resources.md)** - `Resource<T>` interface, adding new resources, site module, unified deploy
- **[Error handling](error-handling.md)** - Error hierarchy, throwing patterns, error codes, `CLIExitError`, `process.exit` ban
- **[Writing tests](testing.md)** - Testkit, Given/When/Then pattern, API mocks, fixtures, test overrides
- **[Telemetry & error reporting](telemetry.md)** - PostHog `ErrorReporter`, what's captured, disabling
- **[Writing & maintaining docs](writing-docs.md)** - Progressive disclosure, style rules, keywords, adding new topic guides
