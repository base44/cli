# Base44 App

A React + TypeScript app with Base44 backend.

## Structure

```
base44/               # Backend configuration
├── config.jsonc      # Project settings
└── entities/         # Data schemas
    └── task.jsonc    # Task entity

src/                  # Frontend code
├── App.tsx           # Main app component
└── api/              # Base44 client
```

## Development

```bash
npm install
npm run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check + build for production |
| `npm run preview` | Preview production build |

## Base44 CLI

```bash
base44 login          # Authenticate
base44 entities push  # Push entity schemas
base44 deploy         # Deploy backend + hosting
```
