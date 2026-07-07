# Gonen — Portfolio Site

A **Wix Managed Headless** portfolio site for an illustrator/visual artist, built with
Astro and wired to the Wix Portfolio backend. Created with the
[`wix/skills` headless skill](https://www.wix.com/skills).

**Live site:** https://gonen-f71cb54a-gonenj.wix-site-host.com

## What's here

The frontend source lives in [`gonen-portfolio/`](./gonen-portfolio). Hosting, the backend
content (collections + projects), and SEO for main pages are all managed by Wix.

| Page | Route | Description |
|---|---|---|
| Home | `/` | Hero, selected work, and series overview. |
| Work | `/work` | Full gallery grouped by collection (anchored per series). |
| Project | `/work/[slug]` | Per-project detail: metadata, media gallery, JSON-LD. |
| About | `/about` | Bio, services, process, and contact — the requested About page. |

## Backend (Wix Portfolio app)

Seeded via the Wix REST API (text-only — no imagery generated):

- **Collections:** `Editorial`, `Personal Work`
- **Projects:** The Long Commute, Climate Futures (Editorial); Nightgarden, Paper Creatures (Personal Work)

Content is read **live** at request time (`@wix/portfolio`), so any project or collection
the owner adds in the Wix dashboard appears automatically — no code change or redeploy needed.
Adding new *field types*, *pages*, or *collections* still requires code.

Image slots render on-brand themed placeholder blocks until real cover images are added in
the dashboard, at which point they resolve automatically via the Wix media SDK.

## Develop

> Must be run **outside** an npm workspace — the Wix scaffolder refuses to generate inside one.

```bash
cd gonen-portfolio
npm install --ignore-scripts   # --ignore-scripts avoids sharp's from-source build; keeps rollup's native binary
npm run dev                    # local dev server (wix dev)
npm run build                  # wix build
npm run release                # wix release — publishes to Wix hosting
```

Auth is ambient on Wix-managed Astro — there is no client/`clientId` in app code; every
`@wix/portfolio` call is authenticated automatically. Secrets (`.env.local`) are never committed.
