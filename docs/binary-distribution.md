# Binary Distribution

**Keywords:** binary, binaries, homebrew, brew, standalone, compile, bun build, assets, templates, backend-runtime, checksums, archive, tar.gz

The CLI is distributed in two ways: as an npm package (`base44`) and as standalone compiled binaries for Homebrew / direct download.

## How It Works

The binary release pipeline has two steps:

1. **`infra/build-binaries.ts`** — compiles self-contained executables using `bun build --compile`:
   - Creates `dist/assets.tar.gz` from **dist/assets/** (templates + backend-runtime)
   - Cross-compiles for 5 targets (macOS arm64/x64, Linux arm64/x64, Windows x64)

2. **`infra/package-binaries.ts`** — packages each binary for release:
   - Wraps each binary (renamed to `base44` / `base44.exe`) and `README.md` in a `.tar.gz` archive
   - Deletes the raw binary

```bash
bun run build            # Must run first — produces dist/cli/ and dist/assets/
bun run build:binaries   # Compile standalone binaries into dist/binaries/
bun run package:binaries # Archive, checksum, and clean up raw binaries
```

## Binary Entry Point

`bin/binary-entry.ts` is the entry point for compiled binaries (npm uses `bin/run.js` instead).

It embeds a single `assets.tar.gz` into the binary using Bun's `import ... with { type: "file" }` syntax. At runtime, this resolves to a path inside Bun's virtual `$bunfs` filesystem, which only `Bun.file()` can read. On first run per version, the entry point extracts the tarball to `~/.base44/assets/<version>/`.

## Asset Path Resolution

Both npm and binary distributions use the same standard location: **`~/.base44/assets/<version>/`**.

- **Binary**: `bin/binary-entry.ts` extracts the embedded tarball there on first run.
- **npm**: `runCLI()` copies from `dist/assets/` to the same location on first run via `ensureNpmAssets()`.

Asset getters in `src/core/assets.ts` are zero-argument functions that compute paths from the version embedded at build time:

```typescript
// src/core/assets.ts
export function getTemplatesDir(): string {
  return join(ASSETS_DIR, "templates");
}
```

No `assetsDir` parameter is passed through CLIContext or function signatures. Adding new asset types only requires putting them under **dist/assets/** and wiring the build; **build-binaries.ts** collects the whole `dist/assets/` folder with no per-item list.

## Homebrew Formula

`infra/homebrew/base44.rb` is a template for the Homebrew tap formula. It downloads the `.tar.gz` archive for the user's platform from GitHub Releases. Homebrew auto-extracts the tarball, so the install block simply does `bin.install "base44"`.

The template uses `PLACEHOLDER_*` SHA256 values that are replaced automatically by CI on each release. The rendered formula is pushed to the [base44/homebrew-tap](https://github.com/base44/homebrew-tap) repository at `Formula/base44.rb`.

Users install with:
```bash
brew install base44/tap/base44
```

## CI Integration

The `manual-publish.yml` workflow runs `build:binaries` then `package:binaries` after `bun run build`, and uploads the resulting `.tar.gz` files to the GitHub Release. Binaries are excluded from the npm package via `.npmignore`.

For `latest` tag releases (not beta/alpha), the workflow also updates the Homebrew tap automatically:
1. Computes SHA256 checksums for each platform archive
2. Renders the formula template with the new version and checksums
3. Pushes the updated formula to `base44/homebrew-tap`

## Rules

1. **Run `bun run build` before `bun run build:binaries`** — the binary build depends on `dist/cli/` and `dist/assets/`
2. **Run `bun run package:binaries` after `bun run build:binaries`** — archives the raw executables
3. **Keep binaries out of npm** — `dist/binaries/` and `dist/assets.tar.gz` must stay in `.npmignore`
4. **Update the Homebrew formula** when adding new platforms or changing binary names
