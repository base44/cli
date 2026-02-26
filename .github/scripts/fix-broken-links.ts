import { readFileSync, writeFileSync } from "node:fs";

interface LycheeLink {
  url: string;
  status: { code: number } | string;
}

interface LycheeResults {
  fail_map?: Record<string, LycheeLink[]>;
  error_map?: Record<string, LycheeLink[]>;
}

/**
 * Reads lychee JSON results and strips broken link markup from a markdown file.
 * [text](broken-url) → text
 * Skips image links ![alt](url).
 */
export function fixBrokenLinks(
  lycheeResultsPath: string,
  markdownPath: string,
): boolean {
  const brokenUrls = parseBrokenUrls(lycheeResultsPath);

  if (brokenUrls.size === 0) {
    console.log("No broken links found");
    return false;
  }

  const original = readFileSync(markdownPath, "utf8");
  let content = original;

  for (const url of brokenUrls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    content = content.replace(
      new RegExp(`(?<!!)\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"),
      "$1",
    );
  }

  if (content === original) {
    console.log("No broken links in markdown to fix");
    return false;
  }

  writeFileSync(markdownPath, content);
  console.log(
    `Removed ${brokenUrls.size} broken link(s) from ${markdownPath}`,
  );
  return true;
}

export function parseBrokenUrls(lycheeResultsPath: string): Set<string> {
  const brokenUrls = new Set<string>();
  try {
    const results: LycheeResults = JSON.parse(
      readFileSync(lycheeResultsPath, "utf8"),
    );
    for (const links of Object.values(results.fail_map || {})) {
      for (const link of links) brokenUrls.add(link.url);
    }
    for (const links of Object.values(results.error_map || {})) {
      for (const link of links) brokenUrls.add(link.url);
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Warning: could not parse lychee results: ${err}`);
    }
  }
  return brokenUrls;
}

if (import.meta.main) {
  const lycheeResults = process.argv[2] || ".lychee-results.json";
  const markdownFile = process.argv[3] || "README.md";
  fixBrokenLinks(lycheeResults, markdownFile);
}
