# Binary Distribution

**Keywords:** binary, binaries, homebrew, brew, standalone, compile, bun build, assets, templates, deno-runtime, checksums

The CLI is distributed in two ways: as an npm package (`base44`) and as standalone compiled binaries for Homebrew / direct download.

## How It Works

`infra/build-binaries.ts` builds self-contained executables using `bun build --compile`. The script:

1. Creates `dist/assets.tar.gz` from the single **dist/assets/** folder (templates + deno-runtime)
2. Cross-compiles for 5 targets (macOS arm64/x64, Linux arm64/x64, Windows x64)
3. Generates SHA256 checksums for each binary

```bash
bun run build          # Must run first — produces dist/cli/ and dist/assets/
bun run build:binaries # Then compile standalone binaries into dist/binaries/
```

## Binary Entry Point

`src/cli/binary-entry.ts` is the entry point for compiled binaries (npm uses `bin/run.js` instead).

It embeds a single `assets.tar.gz` into the binary using Bun's `import ... with { type: "file" }` syntax. At runtime, this resolves to a path inside Bun's virtual `$bunfs` filesystem, which only `Bun.file()` can read. On first run per version, the entry point extracts the tarball to `~/.base44/assets/<version>/` and calls `runCLI({ assetsDir })` so the CLI receives the extracted path via **CLIContext.assetsDir**.

## Asset Path Resolution

The assets directory is provided via **CLIContext.assetsDir**. The binary entry passes it into `runCLI({ assetsDir })`; the npm path calls `runCLI()` with no args, so `context.assetsDir` is undefined. Core and CLI code accept an optional `assetsDir` and fall back to `__dirname`-relative paths when it's undefined (e.g. `dist/assets/templates`, `dist/assets/deno-runtime`):

```typescript
// src/core/config.ts
export function getTemplatesDir(assetsDir?: string): string {
  if (assetsDir) return join(assetsDir, "templates");
  return join(__dirname, "../assets/templates");
}
```

Commands that need asset paths (e.g. create, dev) receive `context` and pass `context.assetsDir` into these helpers. Adding new asset types only requires putting them under **dist/assets/** and wiring the build; **build-binaries.ts** collects the whole `dist/assets/` folder with no per-item list.

## Homebrew Formula

`infra/homebrew/base44.rb` is a reference template for the Homebrew tap. It downloads the correct binary for the user's platform from GitHub Releases. Copy it to the `homebrew-tap` repo and update version + SHA256 values on each release.

## CI Integration

The `manual-publish.yml` workflow builds binaries after `bun run build` and uploads them to the GitHub Release. Binaries are excluded from the npm package via `.npmignore`.

## Rules

1. **Run `bun run build` before `bun run build:binaries`** — the binary build depends on `dist/cli/` and `dist/assets/`
2. **Keep binaries out of npm** — `dist/binaries/` and `dist/assets.tar.gz` must stay in `.npmignore`
3. **Update the Homebrew formula** when adding new platforms or changing binary names
