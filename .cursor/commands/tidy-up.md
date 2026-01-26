# Pre-PR Tidy-Up Review

Review all changes in this branch before pushing to PR. 

## Instructions

First, understand the scope of changes:
1. Run `git diff main...HEAD --name-only` to list all changed files
2. Run `git log main..HEAD --oneline` to see all commits
3. Run `git diff main...HEAD` to review actual changes
4. Read `AGENTS.md` for project standards and patterns

Then systematically review each section below.

---

## 1. Code Quality & Readability

- [ ] Code follows patterns and conventions defined in `AGENTS.md`
- [ ] Logic flows linearly and is easy to follow - no spaghetti code
- [ ] Functions do one thing and are appropriately sized
- [ ] No deeply nested conditionals - use early returns or extract functions
- [ ] No duplicate code - extract shared logic into utilities
- [ ] No magic numbers/strings - use named constants
- [ ] No unused variables, imports, or dead code
- [ ] Consistent naming conventions throughout

---

## 2. Comments Cleanup

Remove unnecessary comments:
- [ ] Commented-out code (use git history instead)
- [ ] Obvious comments that repeat the code
- [ ] Resolved TODO/FIXME comments
- [ ] Placeholder comments from templates

Keep valuable comments:
- WHY explanations for non-obvious decisions
- Complex algorithm explanations
- JSDoc for exported functions

---

## 3. User Experience (CLI Output)

Review all user-facing messages:
- [ ] Messages are clear and actionable
- [ ] Error messages explain the problem AND suggest a fix
- [ ] No jargon - use language end users understand
- [ ] No typos or grammatical errors
- [ ] Consistent tone and capitalization

---

## 4. Documentation Updates

- [ ] Update `AGENTS.md` if changes affect architecture, patterns, or folder structure
- [ ] Update `README.md` if changes affect user-facing features or commands

---

## 5. Type Safety

- [ ] No `any` types unless necessary (and documented why)
- [ ] Zod schemas validate all external data (API responses, config files)
- [ ] Use `import type` for type-only imports

---

## 6. Final Checks

Run and fix any issues:
```bash
npm run lint
npm run typecheck
npm test
npm run build
```

---

## Output

Provide:
1. **Summary**: Brief overview of changes reviewed
2. **Issues Found**: Problems discovered, grouped by category
3. **Fixes Applied**: What was fixed
4. **Remaining Items**: Anything needing manual decision
