# Authoring Agent Instructions

**Keywords:** skills, SKILL.md, CLAUDE.md, AGENTS.md, subagents, agent instructions, progressive disclosure, frontmatter, description

Guide for writing Claude Code skills, CLAUDE.md project instructions, AGENTS.md files, and subagent definitions.

## Core Principle

Every token competes with conversation history, other skills, and the user's request. Only add what Claude doesn't already know. Challenge each line: "Does this justify its token cost?"

## CLAUDE.md

CLAUDE.md is the project's constitution — short directives + pointers to where truth lives.

### Structure

```markdown
# Project Name

## Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |

## Stack
Brief list: React 19 | TypeScript | Prisma | PostgreSQL

## Architecture Constraints
- Only non-obvious rules Claude can't infer from code

## Coding Patterns
- Route convention, error handling, validation approach

## Do Not Edit
- List auto-generated directories

## Testing
- How to run tests, framework, expected patterns
```

### Include

- Commands (build, test, lint, deploy)
- Stack summary (one line)
- Non-obvious architecture decisions with *why*
- File/directory conventions Claude can't infer
- Error handling patterns specific to the project

### Exclude

- Code style rules (use linters — never send an LLM to do a linter's job)
- Obvious language features Claude already knows
- Lengthy framework explanations
- Duplicated info from README
- Time-sensitive information

### Anti-patterns

- Treating CLAUDE.md as onboarding docs (it's directives, not a tutorial)
- Adding things Claude already knows ("JavaScript uses `const` for constants")
- Duplicating linter rules
- Over 200 instructions (frontier models attend to ~150-200 reliably)

## Skill Authoring (SKILL.md)

### Frontmatter

```yaml
---
name: my-skill-name    # lowercase, hyphens, max 64 chars
description: >         # max 1024 chars, third person
  Processes X and generates Y. Use when working with Z files,
  when the user mentions A, B, or C, or when imports from D
  are detected in the codebase.
---
```

- `name`: lowercase letters, numbers, hyphens only. No "anthropic" or "claude".
- `description`: Third person. Include BOTH what it does AND when to trigger it. This is the primary discovery mechanism.
- No other frontmatter fields.

### Body

- Under 500 lines. Split into reference files if approaching limit.
- Imperative form ("Extract text", not "Extracting text").
- Concise examples over verbose explanations.
- One level of reference depth (no nested references).

### Progressive Disclosure

Three loading levels:
1. **Metadata** (name + description) — always in context (~100 words)
2. **SKILL.md body** — loaded when skill triggers
3. **Bundled resources** — loaded on demand by Claude

### Bundled Resources

| Directory | Purpose | Loaded? |
|-----------|---------|---------|
| `scripts/` | Executable code for deterministic tasks | Executed, not read |
| `references/` | Documentation Claude reads as needed | Read on demand |
| `assets/` | Files used in output (templates, images) | Used, not read |

### Good Descriptions

```yaml
description: >
  Extract text and tables from PDF files, fill forms, merge documents.
  Use when working with PDF files or when the user mentions PDFs,
  forms, or document extraction.
```

### Bad Descriptions

```yaml
description: Helps with documents           # too vague
description: I can help you process files   # first person
description: You can use this to analyze    # second person
```

## Subagent Definitions (.claude/agents/)

```markdown
---
name: researcher
description: Explores codebases to answer architectural questions
tools: Read, Glob, Grep, WebFetch
---

Research the codebase to answer the user's question.
Focus on architecture and patterns, not implementation details.
Report findings concisely — bullet points over paragraphs.
```

### Skills vs Subagents

| Use Case | Mechanism |
|----------|-----------|
| Specialized domain knowledge | Skill |
| Workflow with bundled scripts | Skill |
| Isolated task needing own context | Subagent |
| Task that reads many files | Subagent |
| Reusable across projects | Skill (user-level) |

## Checklist

Before shipping any instruction file:

- [ ] Under token budget? (CLAUDE.md: ~200 directives, SKILL.md: ~500 lines)
- [ ] No info Claude already knows?
- [ ] No linter rules disguised as instructions?
- [ ] Description includes what + when? (skills only)
- [ ] Third-person description? (skills only)
- [ ] Progressive disclosure used for large content?
