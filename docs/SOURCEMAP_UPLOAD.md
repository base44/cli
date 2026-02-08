# Sourcemap Upload to PostHog

This document explains how to upload sourcemaps to PostHog for better error tracking.

## Overview

The CLI now generates external sourcemaps (`.js.map` files) during the build process. These sourcemaps should be uploaded to PostHog whenever a new version is published to npm.

## Setup Instructions

### 1. Add PostHog Project API Key Secret

You need to add a GitHub secret with your PostHog Project API Key:

1. Go to PostHog Settings → Project → Project API Key
2. Copy the Project API Key (not the Team API Key)
3. In GitHub, go to Settings → Secrets and variables → Actions
4. Add a new repository secret named `POSTHOG_PROJECT_API_KEY` with the copied value

### 2. Modify the Manual Publish Workflow

Add the following step to `.github/workflows/manual-publish.yml` after the "Build package" step (line 150):

```yaml
      - name: Upload sourcemaps to PostHog
        if: github.event.inputs.dry_run == 'false'
        uses: PostHog/posthog-js-sourcemaps-upload-action@v1
        with:
          api_key: ${{ secrets.POSTHOG_PROJECT_API_KEY }}
          project_id: phc_VsHW5HxTzpORanESQh9A08tmZLQkKbtIBTYoQvRpPOp
          version: ${{ env.NEW_VERSION }}
          source_map_dir: ./dist/cli
```

### 3. (Optional) Add to Other Publishing Workflows

If you have other workflows that publish the package (like `preview-publish.yml`), add the same step there as well.

## How It Works

1. The build process (`bun run build`) now generates external sourcemaps alongside the JavaScript files in `dist/cli/`
2. When publishing to npm, the GitHub Action uploads these sourcemaps to PostHog
3. PostHog uses the sourcemaps to provide better stack traces in error reports
4. The sourcemaps are associated with the version number from `package.json`

## Configuration Details

- **api_key**: Your PostHog Project API Key (stored as a GitHub secret)
- **project_id**: The PostHog public API key from `src/cli/telemetry/consts.ts` (`phc_VsHW5HxTzpORanESQh9A08tmZLQkKbtIBTYoQvRpPOp`)
- **version**: The version being published (e.g., `0.0.28`)
- **source_map_dir**: The directory containing the built JavaScript files and their sourcemaps (`./dist/cli`)

## Verification

After publishing, you can verify the sourcemap upload in PostHog:

1. Go to PostHog Error Tracking
2. Check that new errors show proper file names and line numbers
3. Verify that stack traces include your source TypeScript code, not just bundled JavaScript

## References

- [PostHog Sourcemap Documentation](https://posthog.com/docs/error-tracking/upload-source-maps)
- [PostHog GitHub Action](https://github.com/PostHog/posthog-js-sourcemaps-upload-action)
