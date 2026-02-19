# Changelog


## [0.0.33] - 2026-02-19

### Added

- CLI local dev functions support (#249)
- Automated error reporter GitHub Action (#267)
- MIT License (#257)

### Changed

- Update CLI status from alpha to beta (#248)
- Refactor AGENTS.md to a new docs structure (#253)
- Add `isNonInteractive` to CLIContext for aligned behavior (#254)
- Align CLI schemas with backend (#252)
- Bump clack version to latest with small fixes (#264)
- Knip include classMember (#263)

### Fixed

- Reauthorization issue (#250)
- Remove PII from error reports (#269)

## [0.0.32] - 2026-02-16

### Added

- OAuth connector resource with `base44 connectors` commands (#189)
- Connector pull command to sync connectors from remote (#214)
- Connectors integration in unified `base44 deploy` command (#211)
- Allow skipping OAuth with Esc key in connector setup (#217)
- `ConnectorTypeRegistry` to generated types (#236)
- `limit` parameter to listProjects API call (#245)
- `type` command shown in the help menu (#244)
- Knip dead code detection setup (#239)
- Readme update workflow (#209)

### Changed

- CLI local dev full proxy support (#226)
- Trailing comma standard enforcement (#230)
- Biome linting on save (#227)
- Change global timeout to request-specific timeouts (#243)
- Extend request timeouts to 3 minutes (#242)
- Remove agent name pattern validation (#231)

## [0.0.31] - 2026-02-10

### Added

- `base44 eject` command to eject project from Base44 (#220)

### Fixed

- Wrap name registries with quotes for safety (#223)
- Use `npm install -g base44@latest` instead of `npm update -g base44` for upgrade notification (#222)

## [0.0.30] - 2026-02-09

### Added

- Function automation schemas for trigger-based function execution (#197)

### Fixed

- Handle 428 Precondition Required API error status codes in entity operations (#218)

## [0.0.29] - 2026-02-09

### Added

- Upgrade notification when a newer CLI version is available (#157)
- Collect API request/response data in error reporter for better debugging (#201)
- Upload sourcemaps to PostHog for improved error tracking (#208)

### Changed

- Simplify function schemas (#196)
- Add Bun build with watch mode for faster development (#198)

### Fixed

- Fix user ID collection in error reporter context (#206)

### Docs

- Add missing commands to README (#204)

## [0.0.28] - 2026-02-02

### Changed

- Use Bun for local development and Biome for linting/formatting (#183)
- Fix publish workflows for npm authentication

## [0.0.27] - 2026-02-02

### Added

- `base44 site open` and `base44 dashboard open` commands to open URLs in browser (#169)

### Changed

- Improve schema validation error messages with nicer error message (#177)
- Wrap PR description in NOTE callout block (#172)
- Add CLAUDE.md symlink to AGENTS.md for code review plugin (#182)

## [0.0.26] - 2026-02-01

### Added

- PostHog error monitoring and telemetry for CLI executions (#156)
- Dependency injection for commands and program via `CLIContext` (#156)
- Agent hints and error context display on errors (#161)
- Agent deployment to unified `base44 deploy` command (#149)
- AI agent to backend-and-client template (#153)
- CLI integration tests (#19)

### Changed

- Better error messages with structured error hierarchy (`UserError` / `SystemError`) (#159)
- Enhance resource schema validation with comprehensive Zod types (#151)
- Centralize API error handling in ky client (#135)

### Fixed

- Update skill installation command in README and CLI create command (#162)

## [0.0.25] - 2026-01-28

### Added

- Support multifile upload when deploying functions (#146)

## [0.0.24] - 2026-01-28

### Added

- `--no-skills` flag to create command to skip skills installation (#142)

## [0.0.23] - 2026-01-28

### Added

- Detect non-TTY environments and disable animations (#139)

### Changed

- Change 'Pick a template' to 'Pick an option' in create command (#137)

### Fixed

- Trigger skills repo notification directly from publish workflow (#134)

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
