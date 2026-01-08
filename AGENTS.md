# AI Agent Guidelines for Base44 CLI Development

This document provides essential context and guidelines for AI agents working on the Base44 CLI project.

**Important**: Keep this file updated when making significant architectural changes.

## Project Overview

The Base44 CLI is a TypeScript-based command-line tool built with:
- **Commander.js** - CLI framework for command parsing
- **@clack/prompts** - Interactive user prompts and UI components
- **Zod** - Schema validation for API responses, config files, and user inputs
- **TypeScript** - Primary language
- **tsdown** - Bundler (powered by Rolldown, the Rust-based Rollup successor)

### Project Structure
- **Package**: `base44` - Single package published to npm
- **Core Module**: `src/core/` - Resources, utilities, errors, and config
- **CLI Module**: `src/cli/` - CLI commands and entry point

## Folder Structure

```
cli/
├── src/
│   ├── core/
│   │   ├── auth/                # Auth (user authentication, not a project resource)
│   │   │   ├── api.ts
│   │   │   ├── schema.ts
│   │   │   ├── config.ts
│   │   │   └── index.ts
│   │   ├── resources/           # Project resources (entity, function, etc.)
│   │   │   ├── entity/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── resource.ts
│   │   │   │   └── index.ts
│   │   │   ├── function/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── resource.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── config/              # Project/app configuration
│   │   │   ├── resource.ts      # Resource<T> interface
│   │   │   ├── project.ts       # Project loading logic
│   │   │   ├── app.ts
│   │   │   └── index.ts
│   │   ├── utils/
│   │   ├── consts.ts
│   │   ├── errors.ts
│   │   └── index.ts
│   └── cli/
│       ├── commands/
│       │   ├── auth/
│       │   └── project/
│       ├── utils/
│       └── index.ts
├── dist/
├── package.json
└── tsconfig.json
```

## Resource Pattern

Resources are project-specific collections (entities, functions) that can be loaded from the filesystem.

### Resource Interface (`config/resource.ts`)
```typescript
export interface Resource<T> {
  readAll(dir: string): Promise<T[]>;
}
```

### Resource Implementation (`resources/<name>/resource.ts`)
```typescript
export const entityResource: Resource<Entity> = {
  readAll: readAllEntities,
};
```

### Adding a New Resource
1. Create folder in `src/core/resources/<name>/`
2. Add `schema.ts` with Zod schemas
3. Add `config.ts` with file reading logic
4. Add `resource.ts` implementing `Resource<T>`
5. Add `index.ts` barrel exports
6. Register in `config/project.ts` resources list
7. Add typed field to `ProjectData` interface

## Path Aliases

Single alias defined in `tsconfig.json`:
- `@core/*` → `./src/core/*`

```typescript
import { readProjectConfig } from "@core/config/project.js";
import { entityResource } from "@core/resources/entity/index.js";
```

## Important Rules

1. **npm only** - Never use yarn
2. **Zod validation** - Required for all external data
3. **@clack/prompts** - For all user interaction
4. **ES Modules** - Use `.js` extensions in imports
5. **Cross-platform** - Use `path` module utilities, never hardcode separators
6. **Command wrapper** - All commands use `runCommand()` utility
7. **Task wrapper** - Use `runTask()` for async operations with spinners
8. **Keep AGENTS.md updated** - Update this file when architecture changes

## Development

```bash
npm run build      # tsdown - bundles to single file in dist/cli/index.js
npm run typecheck  # tsc --noEmit - type checking only
npm run dev        # tsx for development
npm test           # vitest
```

### Node.js Version

This project requires Node.js >= 20.19.0. A `.node-version` file is provided for fnm/nodenv.

## File Locations

- `cli/plan.md` - Implementation plan
- `cli/AGENTS.md` - This file
- `cli/src/core/` - Core module
- `cli/src/cli/` - CLI commands
- `cli/tsdown.config.ts` - Build configuration
- `cli/.node-version` - Node.js version pinning