# Chrome Bookmarks Extension

A Chrome extension for bookmarking websites with AI-powered search, built with WXT framework and Base44 backend.

## Features

- **Save Bookmarks**: Save any website with a single click
- **View Bookmarks**: Browse your saved bookmarks in the popup
- **AI Search**: Search through your bookmarks using natural language
- **Base44 Backend**: Powered by Base44 for data storage and AI capabilities

## Structure

```
base44/               # Backend configuration
├── config.jsonc      # Project settings
├── entities/         # Data schemas
│   └── bookmark.jsonc # Bookmark entity
└── agents/           # AI agents
    └── search_agent.jsonc # Bookmark search agent

wxt-src/              # Extension source code
├── entrypoints/
│   ├── background/   # Background service worker
│   ├── content/      # Content scripts
│   └── popup/        # Extension popup UI
└── components/       # Shared React components

public/               # Static assets
└── icon/             # Extension icons
```

## Development

```bash
npm install
npm run dev
```

This will start WXT in development mode with hot-reload enabled.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development mode (Chrome) |
| `npm run dev:firefox` | Start development mode (Firefox) |
| `npm run build` | Build for production (Chrome) |
| `npm run build:firefox` | Build for production (Firefox) |
| `npm run zip` | Create distribution zip (Chrome) |
| `npm run zip:firefox` | Create distribution zip (Firefox) |

## Base44 Setup

```bash
base44 login          # Authenticate
base44 entities push  # Push entity schemas
base44 agents push    # Push AI agents
base44 deploy         # Deploy backend
```

## Loading the Extension

### Chrome
1. Run `npm run build` to create the production build
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `.output/chrome-mv3` directory

### Firefox
1. Run `npm run build:firefox`
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select any file in the `.output/firefox-mv3` directory

## Usage

1. **Save a Bookmark**: Click the extension icon and press "Save Current Page"
2. **View Bookmarks**: Open the popup to see your saved bookmarks
3. **Search**: Use the search bar with natural language queries like "show me articles about React"
4. **Delete**: Click the trash icon to remove a bookmark

## Architecture

- **WXT Framework**: Modern web extension development framework with Vite
- **React**: UI components with hooks
- **Base44 SDK**: Backend integration for data storage
- **AI Agents**: Natural language search powered by Base44 agents
- **Tailwind CSS**: Utility-first styling
