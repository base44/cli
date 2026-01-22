# Changelog


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
