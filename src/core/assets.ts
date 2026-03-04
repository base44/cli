/**
 * Central asset path resolution for both npm and binary distributions.
 *
 * In the binary path, `binary-entry.ts` calls `setAssetsDir()` after
 * extracting the embedded assets tarball to disk.
 * In the npm path, `assetsDir` stays undefined and callers fall back
 * to `__dirname`-relative paths.
 */

let assetsDir: string | undefined;

export function setAssetsDir(dir: string): void {
  assetsDir = dir;
}

export function getAssetsDir(): string | undefined {
  return assetsDir;
}
