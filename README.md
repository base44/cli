# Base44 CLI

A unified command-line interface for managing Base44 applications, entities, functions, deployments, and related services.

**Zero dependencies** - installs in seconds with no dependency resolution.

## Installation

```bash
# Using npm (globally)
npm install -g base44

# Or run directly with npx
npx base44 <command>
```

## Quick Start

```bash
# 1. Login to Base44
base44 login

# 2. Create a new project
base44 create

# 3. Deploy everything (entities, functions, and site)
npm run build
base44 deploy
```

## Commands

### Authentication

| Command | Description |
|---------|-------------|
| `base44 login` | Authenticate with Base44 using device code flow |
| `base44 whoami` | Display current authenticated user |
| `base44 logout` | Logout from current device |

### Project Management

| Command | Description |
|---------|-------------|
| `base44 create` | Create a new Base44 project from a template |
| `base44 link` | Link an existing local project to Base44 |
| `base44 dashboard` | Open the app dashboard in your browser |

### Deployment

| Command | Description |
|---------|-------------|
| `base44 deploy` | Deploy all resources (entities, functions, and site) |

### Entities

| Command | Description |
|---------|-------------|
| `base44 entities push` | Push local entity schemas to Base44 |

### Functions

| Command | Description |
|---------|-------------|
| `base44 functions deploy` | Deploy local functions to Base44 |

### Site

| Command | Description |
|---------|-------------|
| `base44 site deploy` | Deploy built site files to Base44 hosting |

### Types

| Command | Description |
|---------|-------------|
| `base44 types` | Generate TypeScript types from entity schemas |

**Options:**
- `-o, --output <dir>` - Output directory (default: `src/base44`)
- `--entities-only` - Only generate entity types, skip client types

## TypeScript Type Generation

Generate fully-typed interfaces from your entity schemas for type-safe SDK usage.

### Usage

```bash
# Generate types (outputs to src/base44/)
base44 types

# Custom output directory
base44 types --output ./types
```

### Generated Files

| File | Contents |
|------|----------|
| `entities.ts` | Entity interfaces, CreateInput, UpdateInput, Filter types |
| `client.ts` | Typed SDK client interface |
| `index.ts` | Barrel exports |

### Setup with @base44/sdk

1. Generate types:
   ```bash
   base44 types
   ```

2. Add to `tsconfig.json`:
   ```json
   {
     "include": ["src", "src/base44/entities.ts"]
   }
   ```

3. Use in your code:
   ```typescript
   import { createClient } from '@base44/sdk';
   import type { TypedBase44Client } from './base44/client';

   const base44 = createClient({ appId: 'my-app' }) as TypedBase44Client;

   // Fully typed!
   const { items: tasks } = await base44.entities.Task.list();
   await base44.entities.Task.create({ title: 'Buy milk' });
   ```

### Example

Given an entity schema:
```jsonc
// base44/entities/task.jsonc
{
  "name": "Task",
  "type": "object",
  "properties": {
    "title": { "type": "string", "description": "Task title" },
    "completed": { "type": "boolean", "default": false }
  },
  "required": ["title"]
}
```

Generated types:
```typescript
export interface Task extends BaseEntity {
  title: string;
  completed?: boolean;
}

export interface TaskCreateInput {
  title: string;
  completed?: boolean;
}
```

## Configuration

### Project Configuration

Base44 projects are configured via a `config.jsonc` (or `config.json`) file in the `base44/` subdirectory:

```jsonc
// base44/config.jsonc
{
  "name": "My Project",
  "entitiesDir": "./entities",   // Default: ./entities
  "functionsDir": "./functions", // Default: ./functions
  "site": {
    "outputDirectory": "../dist" // Path to built site files
  }
}
```

### App Configuration

Your app ID is stored in a `.app.jsonc` file in the `base44/` directory. This file is created automatically when you run `base44 create` or `base44 link`:

```jsonc
// base44/.app.jsonc
{
  "id": "your-app-id"
}
```

## Project Structure

A typical Base44 project has this structure:

```
my-project/
├── base44/
│   ├── config.jsonc           # Project configuration
│   ├── .app.jsonc             # App ID (git-ignored)
│   ├── entities/              # Entity schema files
│   │   ├── user.jsonc
│   │   └── product.jsonc
│   └── functions/             # Backend functions
│       └── my-function/
│           ├── config.jsonc
│           └── index.js
├── src/
│   ├── base44/                # Generated types (from `base44 types`)
│   │   ├── entities.ts
│   │   ├── client.ts
│   │   └── index.ts
│   └── ...                    # Your frontend code
├── dist/                      # Built site files (for deployment)
└── package.json
```

## Development

### Prerequisites

- Node.js >= 20.19.0
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/base44/cli.git
cd cli

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev -- <command>
```

### Available Scripts

```bash
npm run build      # Build with tsdown
npm run typecheck  # Type check with tsc
npm run dev        # Run in development mode with tsx
npm run lint       # Lint with ESLint
npm test           # Run tests with Vitest
```

### Running the Built CLI

```bash
# After building
npm start -- <command>

# Or directly
./dist/cli/index.js <command>
```
## Contributing

See [AGENTS.md](./AGENTS.md) for development guidelines and architecture documentation.

## License

ISC
