# Binary Distribution

**Keywords:** binary, binaries, homebrew, brew, standalone, compile, bun build, assets, templates, deno-runtime, checksums

The CLI is distributed in two ways: as an npm package (`base44`) and as standalone compiled binaries for Homebrew / direct download.

## How It Works

`infra/build-binaries.ts` builds self-contained executables using `bun build --compile`. The script:

1. Creates `dist/assets.tar.gz` containing both `templates/` and `deno-runtime/`
2. Cross-compiles for 5 targets (macOS arm64/x64, Linux arm64/x64, Windows x64)
3. Generates SHA256 checksums for each binary

```bash
bun run build          # Must run first — produces dist/cli/ and dist/deno-runtime/
bun run build:binaries # Then compile standalone binaries into dist/binaries/
```

## Binary Entry Point

`src/cli/binary-entry.ts` is the entry point for compiled binaries (npm uses `bin/run.js` instead).

It embeds a single `assets.tar.gz` into the binary using Bun's `import ... with { type: "file" }` syntax. At runtime, this resolves to a path inside Bun's virtual `$bunfs` filesystem, which only `Bun.file()` can read. On first run per version, the entry point extracts the tarball to `~/.base44/assets/<version>/` and calls `setAssetsDir()` so core modules find the extracted files.

## Asset Path Resolution

`src/core/assets.ts` provides `setAssetsDir()` / `getAssetsDir()` — a single module that owns asset path resolution. Core modules check for a configured assets dir before falling back to `__dirname`-relative paths:

```typescript
// src/core/config.ts
export function getTemplatesDir(): string {
  const assets = getAssetsDir();
  if (assets) return join(assets, "templates");
  return join(__dirname, "../templates");
}
```

This keeps core code unaware of the distribution method. Adding new assets only requires including them in the tarball and reading them via `getAssetsDir()` — no changes to `binary-entry.ts` needed.

## Homebrew Formula

`infra/homebrew/base44.rb` is a reference template for the Homebrew tap. It downloads the correct binary for the user's platform from GitHub Releases. Copy it to the `homebrew-tap` repo and update version + SHA256 values on each release.

## CI Integration

The `manual-publish.yml` workflow builds binaries after `bun run build` and uploads them to the GitHub Release. Binaries are excluded from the npm package via `.npmignore`.

## Rules

1. **Run `bun run build` before `bun run build:binaries`** — the binary build depends on `dist/cli/` and `dist/deno-runtime/`
2. **Keep binaries out of npm** — `dist/binaries/` and `dist/assets.tar.gz` must stay in `.npmignore`
3. **Update the Homebrew formula** when adding new platforms or changing binary names
