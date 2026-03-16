# Update Changelog

Add entries to `CHANGELOG.md` for all git versions that are tagged but not yet documented.

## Instructions

### 1. Read the current state

- Read `CHANGELOG.md` and identify the **latest documented version** (the first `## [x.y.z]` heading).
- Run `git tag --sort=-v:refname` to list all version tags.
- Every tag newer than the latest documented version is **missing** and needs an entry.
- Also check if `HEAD` has a release commit (`chore: release vX.Y.Z`) beyond the latest tag — include it too.

### 2. Collect commits for each missing version

For each missing version, get the commits between the previous tag and the current one:

```bash
git log --oneline --no-merges v<prev>..v<current>
```

For commits past the latest tag (unreleased):

```bash
git log --oneline --no-merges v<latest_tag>..HEAD
```

Get the date of each version:

```bash
git log -1 --format='%as' v<version>
```

### 3. Categorize commits

| Category | Trigger keywords |
|---|---|
| **Added** | `feat`, `add`, new command/resource/workflow |
| **Changed** | `refactor`, `chore` (non-release), `ci`, improvement, update, bump |
| **Fixed** | `fix`, `revert` |
| **Removed** | `remove`, `delete`, `drop` |
| **Docs** | `docs` |

**Skip these commits entirely:**
- Release commits (`chore: release v...`)
- Changelog/lockfile/formatting-only commits
- Pure CI workflow YAML fixes that don't affect the CLI

### 4. Write the entries

Insert new sections at the top of the file (after `# Changelog`), newest-first:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- Description (#PR)

### Changed

- Description (#PR)

### Fixed

- Description (#PR)
```

Rules:
- Only include categories that have entries
- Write concise, user-facing descriptions — not raw commit messages
- Use imperative mood ("Add X" not "Added X")
- Match the style of existing entries in the file

### 5. Verify

- Versions are in descending order
- No duplicate entries
- Formatting is consistent

## Output

Report which versions were added and a brief summary of each.
