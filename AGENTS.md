# AI Agent Guidelines for Base44 CLI Development

This document provides essential context and guidelines for AI agents working on the Base44 CLI project.

## Project Overview

The Base44 CLI is a TypeScript-based command-line tool built with:
- **Commander.js** - CLI framework for command parsing
- **@clack/prompts** - Interactive user prompts and UI components
- **Zod** - Schema validation for API responses, config files, and user inputs
- **TypeScript** - Primary language

### Project Structure
- **Package**: `base44` - Single package published to npm
- **Core Module**: `src/core/` - Resource modules, utilities, errors, and config
- **CLI Module**: `src/cli/` - CLI commands and entry point

## Key Technologies & Patterns

### CLI Framework
- Use **Commander.js** for all command definitions
- CLI name is **`base44`** 
- Commands follow the pattern: `base44 <command> [subcommand] [options]`

### User Interaction
- Always use **@clack/prompts** for interactive prompts
- Use `@clack/prompts` for:
  - User input collection
  - Progress indicators
  - Spinners for async operations (via `runTask` utility)
  - Confirmation dialogs
  - Selection menus

### Schema Validation
- **Zod is mandatory** for all validation:
  - API response validation
  - Configuration file validation
  - User input validation
  - File schema validation
- Create Zod schemas before implementing features
- Use Zod-inferred types for TypeScript type safety
- Always validate external data before processing

### Code Style & Structure

#### Code Comments
- **Minimal commenting approach**: Only add comments for:
  - Complex algorithms or non-obvious logic
  - Unclear design decisions that need explanation
  - Workarounds or non-standard patterns
- **Avoid commenting**:
  - Self-explanatory code
  - Simple function signatures (TypeScript types provide documentation)
  - Obvious operations (e.g., "// Read the file" when the function is `readFile`)
- **JSDoc comments**: Only use for public APIs that need documentation for external consumers
- Let the code speak for itself - prefer clear naming over comments

#### Project Folder Structure
```
cli/
├── src/
│   ├── core/                    # Core module (shared code)
│   │   ├── auth/               # Auth resource (api, schema, config)
│   │   ├── entity/             # Entity resource (schema, config)
│   │   ├── function/           # Function resource (schema, config)
│   │   ├── config/             # Project/app configuration
│   │   ├── errors/             # Custom error classes
│   │   ├── utils/              # Utility functions
│   │   ├── consts.ts           # Shared constants
│   │   └── index.ts            # Core module exports
│   └── cli/                    # CLI module (main CLI)
│       ├── commands/           # Command implementations (grouped by feature)
│       │   ├── auth/           # Authentication commands (login, logout, whoami)
│       │   └── project/        # Project commands (show-project)
│       ├── utils/              # CLI-specific utilities (runCommand, runTask)
│       └── index.ts            # Main CLI entry point (with shebang)
├── dist/                       # Build output
├── package.json                # Package configuration
└── tsconfig.json               # TypeScript configuration
```

#### Resource Module Structure

Each resource (auth, entity, function) has its own folder containing:
- `schema.ts` - Zod schemas and TypeScript types
- `api.ts` - API client functions (if applicable)
- `config.ts` - Configuration/file reading functions
- `index.ts` - Barrel exports

#### Path Aliases

The project uses a single TypeScript path alias for cleaner imports. Defined in `tsconfig.json` and resolved at build time using `tsc-alias`:

- `@core/*` → `./src/core/*`

**Example usage:**
```typescript
import { writeAuth, generateDeviceCode } from "@core/auth/index.js";
import { readProjectConfig } from "@core/config/project.js";
import { AuthApiError } from "@core/errors/index.js";
```

#### Command Implementation Pattern
```typescript
import { Command } from "commander";
import { log } from "@clack/prompts";
import { runCommand, runTask } from "../../utils/index.js";
import { someApiCall, someConfig } from "@core/resource/index.js";

async function commandFunction(): Promise<void> {
  const result = await runTask(
    "Loading data...",
    async () => {
      return await someApiCall();
    },
    {
      successMessage: "Data loaded",
      errorMessage: "Failed to load data",
    }
  );

  log.info(`Result: ${result}`);
}

export const commandName = new Command("command-name")
  .description("Command description")
  .action(async () => {
    await runCommand(commandFunction);
  });
```

**Important**: 
- All commands must use `runCommand()` wrapper for consistent Base44 branding
- Use `runTask()` for async operations that need spinner feedback
- Use `@core/*` path alias for imports from core module
- Use relative imports for CLI-specific utilities

#### CLI Utilities

**`runCommand(commandFn)`** - Wraps command execution with:
- Base44 intro banner
- Consistent error handling for `AuthApiError`, `AuthValidationError`, and generic errors
- Process exit on error

**`runTask(message, operation, options)`** - Wraps async operations with:
- Automatic spinner management
- Success/error message customization
- Returns the operation result

#### Schema Definition Pattern
```typescript
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
});

export type User = z.infer<typeof UserSchema>;
```

## Development Workflow

### Package Manager
- **Use npm** for all package management operations
- Install dependencies: `npm install`
- Add dependencies: `npm install <package>`
- Add dev dependencies: `npm install -D <package>`

### Build Process
- **Build**: Use `npm run build` to compile TypeScript to JavaScript (runs `tsc && tsc-alias`)
- **Development**: Use `npm run dev` for development mode (uses `tsx` to run TypeScript directly)
- Always build before testing
- **ES Modules**: Package uses `"type": "module"` - use `.js` extensions in imports
- **CLI Entry Point**: Main entry point (`src/cli/index.ts`) includes shebang for direct execution
- **Output**: Compiled JavaScript output goes to `dist/` directory
- **Path Alias Resolution**: `tsc-alias` resolves path aliases in compiled output

### Command Testing
- Test commands by running the compiled CLI or using development mode
- Verify help text: `base44 <command> --help`

## Important Rules

1. **Use npm** for all package management - never yarn
2. **Project structure** - Core module (`src/core/`) contains resource modules and shared code, CLI module (`src/cli/`) contains commands
3. **Path aliases** - Use `@core/*` for imports from core module (e.g., `@core/auth/index.js`, `@core/entity/index.js`)
4. **CLI utilities** - Use relative imports for CLI-specific utilities (`../../utils/index.js`)
5. **Zod validation is required** for all external data
6. **@clack/prompts for all user interaction** - no raw `readline` or `inquirer`
7. **TypeScript strict mode** - maintain type safety
8. **Commander.js for commands** - follow the established pattern
9. **TypeScript compiler for builds** - use `tsc && tsc-alias` for production builds, `tsx` for development
10. **Test commands** after implementation to ensure they're registered
11. **Cross-platform support** - The CLI must work on both Windows and Unix-like systems. Always use `path.join()`, `path.dirname()`, and other `path` module utilities for path operations. Never use string concatenation or hardcoded path separators.
12. **Command wrapper** - All commands must use `runCommand()` utility for consistent Base44 branding
13. **Task wrapper** - Use `runTask()` for async operations that need spinner feedback
14. **ES Modules** - Package uses `"type": "module"` - always use `.js` extensions in import statements
15. **Shared utilities** - Use cross-platform file utilities and config management from `src/core/`
16. **Resource-based organization** - Each resource (auth, entity, function) has its own folder with schema, api, and config files

## Common Patterns

### Adding a New Command
1. Create command file in `src/cli/commands/<feature>/` directory
2. Import and register in main CLI entry point (`src/cli/index.ts`)
3. Use Commander.js Command class
4. Import from appropriate resource module (`@core/auth/index.js`, `@core/entity/index.js`, etc.)
5. Use @clack/prompts for user interaction
6. Use relative imports for CLI utilities (`../../utils/index.js`)
7. Wrap command function with `runCommand()` utility
8. Use `runTask()` for async operations with spinners

### Adding a New Resource
1. Create a new folder in `src/core/<resource>/`
2. Add `schema.ts` with Zod schemas and inferred types
3. Add `api.ts` for API client functions (if applicable)
4. Add `config.ts` for file/config reading functions
5. Add `index.ts` barrel file exporting all public APIs
6. Export from `src/core/index.ts`

### API Integration
1. Define Zod schema in the resource's `schema.ts` file
2. Create API client function in the resource's `api.ts` file
3. Export from the resource's `index.ts`
4. Import in CLI commands using `@core/<resource>/index.js`
5. Validate response with Zod schema
6. Handle errors gracefully
7. Use `runTask()` for loading states

### Configuration Management
1. Define Zod schema in `src/core/config/` or the relevant resource folder
2. Create config management functions alongside the schema
3. Export from the module's `index.ts`
4. Import in CLI commands using `@core/config/` or `@core/<resource>/`
5. Read config file
6. Validate with Zod schema
7. Provide type-safe access via inferred types

## Dependencies Reference

### Core (Required)
- `commander` - CLI framework
- `@clack/prompts` - User prompts and UI components
- `chalk` - Terminal colors
- `zod` - Schema validation
- `p-wait-for` - Polling utility for async operations

### Development
- `typescript` - Language
- `tsx` - TypeScript execution for development mode
- `tsc-alias` - Path alias resolution for compiled output

## File Locations

- **Main plan**: `cli/plan.md` - Full implementation plan
- **This file**: `cli/AGENTS.md` - AI agent guidelines
- **Core module**: `cli/src/core/` - Resource modules (auth, entity, function), config, utils, errors
- **CLI module**: `cli/src/cli/` - CLI commands and entry point

## Questions to Ask

If uncertain about implementation:
1. Check `plan.md` for feature requirements
2. Verify command name matches `base44 <command>` pattern
3. Ensure Zod validation is included
4. Confirm @clack/prompts is used for user interaction
5. Check if feature is in current phase scope

## Notes from Development

- **Project structure**: Single package with core and cli modules
- **Resource-based architecture**: Each resource (auth, entity, function) has its own folder with schema, api, and config
- CLI uses TypeScript with strict type checking
- All commands must be registered in main CLI entry point (`src/cli/index.ts`)
- Build process compiles TypeScript to JavaScript in `dist/` folder and resolves path aliases
- Commands should be testable independently
- Resource modules (auth, entity, function) go in `src/core/<resource>/`
- Shared config (project, app) goes in `src/core/config/`
- CLI-specific code (commands, runCommand, runTask) goes in `src/cli/`
- Use `@core/*` path alias for imports from core module
- Use relative imports for CLI-specific utilities
- Error handling should be user-friendly with clear messages
- Use @clack/prompts for all user-facing interactions (no console.log for prompts)
- All commands use `runCommand()` utility for consistent branding
- Use `runTask()` for async operations with spinner feedback
- Package uses ES modules - imports must use `.js` extensions
- Use cross-platform file utilities from `src/core/utils/` for file operations
- All data validation uses Zod schemas with type inference
