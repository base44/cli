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

- **`packages/cli/src/core/`** - SDK layer: pure business logic with no UI or CLI concerns. Handles resources, auth, API clients, project config, site deployment, error classes, and utilities.
- **`packages/cli/src/cli/`** - Presentation layer: CLI commands, user interaction, theming, telemetry, and wiring. Depends on `core/`, never the reverse.
- **`packages/cli/bin/`** - Entry points: `run.js` (production, Node.js) and `dev.ts` (development, Bun runs TypeScript directly).
- **`packages/cli/templates/`** - Project scaffolding templates for `base44 create`.
- **`packages/cli/tests/`** - CLI integration tests (`cli/`), core unit tests (`core/`), and test fixtures (`fixtures/`).

```
packages/cli/src/
├── core/           # SDK: auth, clients, project, resources (entity/function/agent/connector), site, errors, utils
└── cli/            # UI: commands, telemetry, utils (runCommand, runTask, theme, banner)
```

### Distribution

Near-zero-dependency npm package. Runtime dependencies are bundled into `dist/index.js` at build time and go in `devDependencies` — with one deliberate exception: the local workerd function runtime (`miniflare`, `esbuild`, `@deno/loader`) ships native binaries/WASM that cannot be bundled, so those three are real `dependencies`, marked external in the build, and imported dynamically only when `base44 dev` runs functions. Standalone binaries are also built for Homebrew / direct download via `bun run build:binaries` (see [Binary distribution](binary-distribution.md)); they exclude the workerd runtime and `base44 dev` falls back to the Deno runtime there.

### Path Alias

`@/*` resolves to `./packages/cli/src/*` (defined in `packages/cli/tsconfig.json`). Always use `.js` extensions in imports (ES Modules).

## Development Commands

```bash
bun install            # Install dependencies
bun run build          # Bundle to dist/index.js + copy templates
bun run build:binaries # Compile standalone binaries (for binary test mode)
bun run typecheck      # tsc --noEmit
bun run dev            # Run bin/dev.ts (no build needed, Bun runs TS directly)
bun run start          # Run bin/run.js (requires build first)
bun run test           # Run tests in npm mode (default; use `bun run test`, not `bun test`)
bun run test:npm       # Run tests against node bin/run.js (needs build)
bun run test:binary    # Run tests against compiled binary (needs build + build:binaries)
bun run lint           # Biome - lint and format check
bun run lint:fix       # Biome - auto-fix
```

**Prerequisites**: Bun (`curl -fsSL https://bun.sh/install | bash`), Node.js >= 20.19.0 (for npm publishing).

**Debugging**: `DEBUG=1 base44 deploy` shows full stack traces on errors.

## Rules

These apply to every task. See topic guides below for domain-specific rules.

1. **Bun for everything** - Use `bun` commands for install, test, build, run
2. **Zod validation** - Required for all external data (API responses, config files)
3. **@clack/prompts only** - For all user interaction (prompts, spinners, logs). No `console.log`. Under the global `--json` flag the lifecycle runs **silent** (prompts and spinners suppressed, logs routed to stderr) — never assume a TTY
4. **ES Modules** - Use `.js` extensions in all imports
5. **Cross-platform** - Use `path` module utilities, never hardcode separators
6. **Zero-dependency distribution** - All packages go in `devDependencies`; they get bundled. Sole exception: the workerd function-runtime packages (`miniflare`, `esbuild`, `@deno/loader`) are real `dependencies` — native binaries/WASM cannot bundle
7. **No dynamic imports** - Use static imports at top of file, avoid `await import()`. Sole exception: the external workerd runtime packages are imported dynamically (see `function-bundler.ts` / `function-runtime.ts`) so they load only when dev runs functions, and so the compiled binary can detect their absence and fall back to Deno
8. **consts.ts has no imports** - Keep `consts.ts` dependency-free to avoid circular deps
9. **Keep docs updated** - Update files in `docs/` when architecture changes
10. **Respect the global `--json` flag** - `--json` (global, exposed as `ctx.jsonMode`) makes stdout a single machine-readable JSON document **and enables silent mode**. Never write results with `process.stdout.write`/`console.log`; return them via `RunCommandResult.stdout` and put human status in `outroMessage`/`log` (the lifecycle routes those to stderr under `--json`). New commands that produce data should emit it as JSON `stdout` when `ctx.jsonMode` is set (see the `sandbox`/`connectors` commands); `Base44Command` already supplies a generic fallback (`{ "output": "<status>" }`) and a JSON error envelope, so any command stays parseable

## Topic Guides

Read these when working on the relevant area:

- **[Adding or modifying CLI commands](commands.md)** - Factory pattern, `runCommand()`, `runTask()`, `CLIContext`, theming, `chalk` ban
- **[Making API calls](api-patterns.md)** - HTTP clients, Zod snake_case-to-camelCase transforms, `ApiError.fromHttpError()`
- **[Working with resources](resources.md)** - `Resource<T>` interface, adding new resources, site module, unified deploy
- **[Deployments API](deployments.md)** - Static-site deploys addressed by commit, asset manifest hashing, presigned uploads, index.html finalize sentinel
- **[Plugins](plugins.md)** - Plugin config, namespaces, entity extension rules, function namespacing, pull/deploy behavior
- **[Error handling](error-handling.md)** - Error hierarchy, throwing patterns, error codes, `CLIExitError`, `process.exit` ban
- **[Writing tests](testing.md)** - Testkit, Given/When/Then pattern, API mocks, fixtures, test overrides
- **[Telemetry & error reporting](telemetry.md)** - PostHog `ErrorReporter`, what's captured, disabling
- **[Writing & maintaining docs](writing-docs.md)** - Progressive disclosure, style rules, keywords, adding new topic guides
- **[Authoring agent instructions](authoring-agent-instructions.md)** - Skills, CLAUDE.md, AGENTS.md, subagent definitions, progressive disclosure
- **[Binary distribution](binary-distribution.md)** - Standalone binaries, Homebrew formula, asset embedding, `bun build --compile`
