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
├── src/                       # Your frontend code
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
