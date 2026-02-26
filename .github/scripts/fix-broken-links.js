import { readFileSync, writeFileSync } from "fs";

/**
 * Reads lychee JSON results and strips broken link markup from a markdown file.
 * [text](broken-url) → text
 */
export function fixBrokenLinks(lycheeResultsPath, markdownPath) {
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
      new RegExp(`\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"),
      "$1",
    );
  }

  if (content === original) {
    console.log("No broken links in markdown to fix");
    return false;
  }

  writeFileSync(markdownPath, content);
  console.log(`Removed ${brokenUrls.size} broken link(s) from ${markdownPath}`);
  return true;
}

export function parseBrokenUrls(lycheeResultsPath) {
  const brokenUrls = new Set();
  try {
    const results = JSON.parse(readFileSync(lycheeResultsPath, "utf8"));
    for (const links of Object.values(results.fail_map || {})) {
      for (const link of links) brokenUrls.add(link.url);
    }
    for (const links of Object.values(results.error_map || {})) {
      for (const link of links) brokenUrls.add(link.url);
    }
  } catch {}
  return brokenUrls;
}

// Run as CLI script
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("fix-broken-links.js") ||
    process.argv[1].endsWith("fix-broken-links.ts"));

if (isMainModule) {
  const lycheeResults = process.argv[2] || ".lychee-results.json";
  const markdownFile = process.argv[3] || "README.md";
  const changed = fixBrokenLinks(lycheeResults, markdownFile);
  process.exit(changed ? 0 : 0);
}
