# Base44 CLI

@.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc

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

- **`src/core/`** - SDK layer: pure business logic with no UI or CLI concerns. Handles resources (entity, function, agent, connector), auth, API clients (`ky`), project config, site deployment, error classes, and file utilities. This layer could be used outside a CLI context.
- **`src/cli/`** - Presentation layer: CLI commands, user interaction (`@clack/prompts`), theming, telemetry, and wiring. Depends on `core/`, never the reverse.
- **`bin/`** - Entry points: `run.js` (production, Node.js) and `dev.ts` (development, Bun runs TypeScript directly).

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

1. **Bun for everything** - Use `bun` commands for install, test, build, run
2. **Zod validation** - Required for all external data (API responses, config files)
3. **@clack/prompts only** - For all user interaction (prompts, spinners, logs). No `console.log`
4. **ES Modules** - Use `.js` extensions in all imports
5. **Cross-platform** - Use `path` module utilities, never hardcode separators
6. **Command factory pattern** - Commands export `getXCommand(context)` functions, not static instances
7. **Command wrapper** - All commands use `runCommand(fn, options, context)` utility
8. **Task wrapper** - Use `runTask()` for async operations with spinners
9. **consts.ts has no imports** - Keep `consts.ts` dependency-free to avoid circular deps
10. **Zero-dependency distribution** - All packages go in `devDependencies`; they get bundled
11. **Use theme for styling** - Never use `chalk` directly; import `theme` from `@/cli/utils/` and use semantic names
12. **Use fs.ts utilities** - Always use `@/core/utils/fs.js` for file operations
13. **No direct process.exit()** - Throw `CLIExitError` instead; entry points handle the exit
14. **Use structured errors** - Never `throw new Error()`; use specific classes from `@/core/errors.js` with hints
15. **SchemaValidationError requires ZodError** - Pass `ZodError`: `new SchemaValidationError("context", result.error)`
16. **No dynamic imports** - Use static imports at top of file, avoid `await import()`
17. **Keep docs updated** - Update files in `docs/` when architecture changes

## Topic Guides

Read these when working on the relevant area:

- **[Adding or modifying CLI commands](commands.md)** - Command factory pattern, `runCommand()`, `runTask()`, `CLIContext`, theming
- **[Making API calls](api-patterns.md)** - HTTP clients, Zod snake_case-to-camelCase transforms, `ApiError.fromHttpError()`
- **[Working with resources](resources.md)** - `Resource<T>` interface, adding new resources, site module, unified deploy
- **[Error handling](error-handling.md)** - Error hierarchy, throwing patterns, error codes, `CLIExitError`
- **[Writing tests](testing.md)** - Testkit, Given/When/Then pattern, API mocks, fixtures, test overrides
- **[Telemetry & error reporting](telemetry.md)** - PostHog `ErrorReporter`, what's captured, disabling
