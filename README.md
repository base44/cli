# Base44 CLI

A unified command-line interface for managing Base44 applications, entities, functions, deployments, and related services.

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

# 3. Push entities to Base44
base44 entities push
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

### Entities

| Command | Description |
|---------|-------------|
| `base44 entities push` | Push local entity schemas to Base44 |

## Configuration

### Project Configuration

Base44 projects are configured via a `config.jsonc` (or `config.json`) file in the `base44/` subdirectory:

```jsonc
// base44/config.jsonc
{
  "id": "your-app-id",           // Set after project creation
  "name": "My Project",
  "entitiesDir": "./entities",   // Default: ./entities
  "functionsDir": "./functions"  // Default: ./functions
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE44_CLIENT_ID` | Your app ID | - |

You can set these in a `.env.local` file in your `base44/` directory:

```bash
# base44/.env.local
BASE44_CLIENT_ID=your-app-id
```

## Project Structure

A typical Base44 project has this structure:

```
my-project/
├── base44/
│   ├── config.jsonc           # Project configuration
│   ├── .env.local             # Environment variables (git-ignored)
│   ├── entities/              # Entity schema files
│   │   ├── user.jsonc
│   │   └── product.jsonc
├── src/                       # Your frontend code
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
