# Changelog


## [0.0.22] - 2026-01-27

### Added

- Agents integration with `base44 agents pull` and `base44 agents push` commands (#112)
- Path alias mapping `@` to `src/` for imports (#124)
- GitHub Actions workflow to notify skills repository on release (#115)
- Allowed bots configuration for claude bot in workflows (#126)

## [0.0.21] - 2026-01-26

_Re-release with no changes_

## [0.0.20] - 2026-01-26

### Added

- GitHub Action for auto PR description generation (#118)

### Changed

- Minor improvements to create command output (#122)

### Fixed

- Make skills installation non-critical in create command (#121)
- Use colon-based allowed-tools patterns for gh commands (#120)
- Change globby pattern to find `.app.jsonc` files (#117)

## [0.0.19] - 2026-01-26

### Fixed

- Change stdio to shell option in skill installation for cleaner output

## [0.0.18] - 2026-01-26

### Added

- AI agent skills option to `base44 create` command (#95)

### Changed

- Simplify AI agent skills selection to yes/no prompt (#111)
- Refactor CLI code to separate concerns between running and exporting (#109)
- Update README documentation (#93)

## [0.0.17] - 2026-01-25

### Changed

- Remove `--existing` flag from link command API (#107)

## [0.0.16] - 2026-01-25

### Added

- Support for linking to existing projects with `base44 link` (#97)
- Claude Code GitHub Workflow for automated code review (#98, #106)

### Changed

- Configuration file changed from `.env.local` to `.app.jsonc` (or `.app.json`) (#96)

## [0.0.15] - 2026-01-22

### Added

- New unified `base44 deploy` command to deploy entities, functions, and site in one step (#92)
- Template option (`--template`) to project creation command (#86)

### Fixed

- Find both `.json` and `.jsonc` files for configuration (#90)

## [0.0.14] - 2026-01-22

### Fixed

- Align params to backend requirements (#89)

## [0.0.13] - 2026-01-22

### Fixed

- Align entities schema API to match backend requirements (#81)
- Fix intro background color (#84)

## [0.0.12] - 2026-01-21

### Added

- New `base44 link` command to link an existing directory to a Base44 app (#83)
- New `base44 dashboard` command to open the app dashboard in browser (#82)

## [0.0.11] - 2026-01-21

### Added

- New `base44 functions deploy` command to deploy backend functions (#75)

## [0.0.10] - 2026-01-21

### Added

- Automatic changelog generation on release (#68)

### Fixed

- Add `.gitignore` to backend-only template to ignore `.env.local` files (#70)
- Fix issue with version detection (#71)

### Changed

- Consolidate color definitions into centralized theme file (#74)
- Relax GitHub issue templates to be more flexible (#72)

## [0.0.8] - 2026-01-19

### Added

- Non-interactive mode for `base44 create` command with `--deploy` flag (#67)

### Fixed

- Fix command output formatting with proper line wrapping (#63)

## [0.0.7] - 2026-01-18

### Changed

- Align intro/outro styling across all commands (#61)
- Various small fixes and improvements (#60)

## [0.0.6] - 2026-01-18

### Added

- Auto-login flow before `create` command when user is not authenticated (#48)
- Automatic `npm install`, `entities push`, and `site deploy` after project creation (#47)
- EJS frontmatter support for custom output paths in templates (#46)
- GitHub issue and PR templates (#44)

### Changed

- Improve template option clarity in create command (#49)
- Minor UI beautifications in create command (#53)

## [0.0.4] - 2026-01-15

### Added

- New `base44 site deploy` command to deploy frontend to Base44 hosting (#20)
- Authentication checks for commands that require user authentication (#28)

### Removed

- Remove unused `show-project` command (#42)

## [0.0.3] - 2026-01-14

### Fixed

- Fix entities push to send the entire schema object instead of just the name (#23)

## [0.0.2] - 2026-01-14

### Added

- Initial public release of the Base44 CLI
- Authentication commands: `login`, `logout`, `whoami` (#5, #10)
- Project configuration parsing from `config.jsonc` and sub-directories (#7)
- `base44 entities push` command to sync entities to remote (#13)
- `base44 create` command to initialize new Base44 projects (#14)
- Template selection when creating new projects (#16)
- Bundle CLI to single file for easier installation (#21)
- Display dashboard link after login (#22)

### Changed

- Refactor folder structure to be organized by command/resource (#8)
- Use tsdown for building (#11)
- Solve circular dependencies and improve API client architecture (#18)
