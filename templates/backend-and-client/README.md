# Todo App

A simple todo list app built with React and Base44 backend.

## Structure

```
base44/               # Backend configuration
├── config.jsonc      # Project settings
└── entities/         # Data schemas
    └── task.jsonc    # Task entity

src/                  # Frontend code
├── App.jsx           # Main todo app
├── api/              # Base44 client
├── components/ui/    # UI components
└── lib/              # Utilities
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
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |

## Base44 CLI

```bash
base44 login          # Authenticate
base44 entities push  # Push entity schemas
base44 deploy         # Deploy backend + hosting
```
