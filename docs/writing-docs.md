# Writing & Maintaining Docs

**Keywords:** docs, documentation, AGENTS.md, CLAUDE.md, progressive disclosure, topic guide, keywords, writing style

This document explains the conventions for writing and maintaining documentation in the `docs/` folder. Follow these rules to keep the docs useful, accurate, and efficient for AI agents.

Root symlinks at the repo root (`AGENTS.md`, `CLAUDE.md`) point to `docs/AGENTS.md` so that different AI tools find the entry point automatically.

## Progressive Disclosure

The docs follow a **progressive disclosure** pattern:

1. **Root doc (`AGENTS.md`)** provides a compact overview: tech stack, architecture, dev commands, universal rules, and links to topic guides. An agent reads only this file to orient itself.
2. **Topic guides** contain the full detail for a specific area. An agent reads a topic guide only when working in that area.

This keeps token usage low. An agent doing entity work reads the root + `resources.md` -- not the entire testing or telemetry docs.

## When to Update

- **Architectural change** (new layer, new pattern, new tool) -- update root doc and/or relevant topic guide
- **New resource type** -- update `resources.md` (add to "Adding a New Resource" and "Unified Deploy" sections)
- **New command pattern** -- update `commands.md`
- **New error class** -- update `error-handling.md` (hierarchy + code reference table)
- **New testkit method** -- update `testing.md` (API Mocks or Testkit API section)
- **New topic area** -- create a new `docs/<topic>.md` and add a link in `AGENTS.md` under "Topic Guides"

## Writing Style

### Be concise
Write for an agent that needs to act, not learn history. Lead with the pattern, then explain briefly. Skip motivations unless they prevent a common mistake.

### Show, don't tell
Prefer a short code example over a paragraph of prose. One good example replaces three paragraphs.

### Use accurate paths
Reference files with `src/` paths (e.g., `src/cli/utils/theme.ts`). When referring to imports in code examples, use the `@/` alias (e.g., `@/cli/utils/index.js`).

### Keep code examples minimal
Show only the relevant pattern. Trim unrelated boilerplate. Use comments like `// ...` to skip irrelevant sections.

### Avoid stale details
Don't list every file in a directory (the directory changes; the list goes stale). Describe the pattern instead, and mention 2-3 representative files.

### Mark rules clearly
Domain-specific rules go in a "Rules" section at the bottom of the topic guide. Universal rules stay in the root doc.

## Keywords

Every topic guide starts with a **Keywords** line right after the title:

```markdown
# Topic Title

**Keywords:** keyword1, keyword2, keyword3
```

Keywords help agents (and humans) discover the right doc. Include:
- The main concept name (e.g., `resource`, `error`, `test`)
- Key class/function names (e.g., `CLIError`, `setupCLITests`)
- Common terms an agent might search for (e.g., `mock`, `deploy`, `spinner`)

## Adding a New Topic Guide

1. Create `docs/<topic>.md`
2. Add a `**Keywords:**` line after the title
3. Write the content following the style rules above
4. Add a link in `docs/AGENTS.md` under "Topic Guides" with a brief description and key keywords
5. Update this file's structure section if needed

## Root Doc (`AGENTS.md`) Rules

The root doc should stay **under 100 lines**. It contains:

- Project identity (name, purpose, one sentence)
- Tech stack (bullet list)
- Architecture (2-3 bullet points + a small directory sketch)
- Distribution strategy (one paragraph)
- Dev commands (one code block)
- Universal rules (numbered list, max ~10)
- Topic guide links (with keyword annotations)

If you find yourself adding detail to the root doc, it probably belongs in a topic guide instead.
