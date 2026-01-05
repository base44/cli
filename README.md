# Base44 CLI

A unified command-line interface for managing Base44 applications, entities, functions, deployments, and related services.

## Installation

```bash
# Using npm
npm install

# Build the project
npm run build

# Run the CLI (multiple ways)
npm start                     # Using node directly
npm run base44                # Using npm (runs node_modules/.bin/base44)
./dist/cli/index.js          # Run executable directly
```

## Development

```bash
# Run in development mode with watch
npm run dev

# Build the project
npm run build

# Clean build artifacts
npm run clean
```

## Commands

### Authentication
- `base44 login` - Authenticate with Base44
- `base44 whoami` - Display current authenticated user
- `base44 logout` - Logout from current device

## Project Structure

```
cli/
├── src/
│   ├── core/                    # Core module (shared code)
│   │   ├── api/                # API client code
│   │   ├── config/             # Configuration management
│   │   ├── schemas/            # Zod schemas
│   │   ├── utils/              # Utility functions
│   │   └── index.ts            # Core module exports
│   └── cli/                     # CLI module (main CLI)
│       ├── commands/            # Command implementations
│       │   └── auth/           # Authentication commands
│       ├── utils/               # CLI-specific utilities
│       └── index.ts             # Main CLI entry point (with shebang)
├── dist/                        # Build output (compiled JavaScript)
├── package.json                 # Package configuration
├── tsconfig.json                # TypeScript configuration
└── README.md
```

## Technologies

- **TypeScript** - Primary language
- **Commander.js** - CLI framework
- **@clack/prompts** - Interactive user prompts
- **Zod** - Schema validation

## License

ISC

