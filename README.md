# Base44 CLI

A unified command-line interface for managing Base44 applications, entities, functions, deployments, and related services.

## Installation

```bash
# Using npm
npm install

# Build the project
npm run build

# Run the CLI
npm start                     # Using node directly
./dist/cli/index.js          # Run executable directly
```

## Development

```bash
# Run in development mode
npm run dev

# Build the project
npm run build

# Run the built CLI
npm run start

# Clean build artifacts
npm run clean

# Lint the code
npm run lint

```

## Commands

### Authentication

- `base44 login` - Authenticate with Base44 using device code flow
- `base44 whoami` - Display current authenticated user
- `base44 logout` - Logout from current device

### Project

- `base44 show-project` - Display project configuration, entities, and functions
