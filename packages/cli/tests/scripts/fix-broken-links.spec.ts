import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  fixBrokenLinks,
  parseBrokenUrls,
} from "../../../../.github/scripts/fix-broken-links.js";

function createTempFiles(
  lycheeResults: object,
  markdown: string,
): { lycheeResultsPath: string; markdownPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "fix-broken-links-"));
  const lycheeResultsPath = join(dir, "lychee-results.json");
  const markdownPath = join(dir, "README.md");
  writeFileSync(lycheeResultsPath, JSON.stringify(lycheeResults));
  writeFileSync(markdownPath, markdown);
  return { lycheeResultsPath, markdownPath };
}

describe("parseBrokenUrls", () => {
  it("extracts URLs from fail_map", () => {
    const { lycheeResultsPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [
            { url: "https://broken.com/a", status: { code: 404 } },
            { url: "https://broken.com/b", status: { code: 500 } },
          ],
        },
      },
      "",
    );
    const urls = parseBrokenUrls(lycheeResultsPath);
    expect(urls).toEqual(
      new Set(["https://broken.com/a", "https://broken.com/b"]),
    );
  });

  it("extracts URLs from error_map", () => {
    const { lycheeResultsPath } = createTempFiles(
      {
        error_map: {
          "README.md": [{ url: "https://timeout.com", status: "Timeout" }],
        },
      },
      "",
    );
    const urls = parseBrokenUrls(lycheeResultsPath);
    expect(urls).toEqual(new Set(["https://timeout.com"]));
  });

  it("combines fail_map and error_map", () => {
    const { lycheeResultsPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [{ url: "https://broken.com", status: { code: 404 } }],
        },
        error_map: {
          "README.md": [{ url: "https://timeout.com", status: "Timeout" }],
        },
      },
      "",
    );
    const urls = parseBrokenUrls(lycheeResultsPath);
    expect(urls).toEqual(
      new Set(["https://broken.com", "https://timeout.com"]),
    );
  });

  it("returns empty set when file does not exist", () => {
    const urls = parseBrokenUrls("/nonexistent/path.json");
    expect(urls).toEqual(new Set());
  });

  it("returns empty set for empty results", () => {
    const { lycheeResultsPath } = createTempFiles({}, "");
    const urls = parseBrokenUrls(lycheeResultsPath);
    expect(urls).toEqual(new Set());
  });

  it("returns empty set and warns on malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "fix-broken-links-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, "not valid json{{{");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls = parseBrokenUrls(path);

    expect(urls).toEqual(new Set());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not parse lychee results"),
    );
    warn.mockRestore();
  });
});

describe("fixBrokenLinks", () => {
  it("strips broken link markup, keeps display text", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [
            { url: "https://broken.com/page", status: { code: 404 } },
          ],
        },
      },
      "Visit [our docs](https://broken.com/page) for more info.",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toBe(
      "Visit our docs for more info.",
    );
  });

  it("strips multiple broken links", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [
            { url: "https://a.com", status: { code: 404 } },
            { url: "https://b.com", status: { code: 500 } },
          ],
        },
      },
      "See [Link A](https://a.com) and [Link B](https://b.com).",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toBe("See Link A and Link B.");
  });

  it("leaves working links untouched", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [{ url: "https://broken.com", status: { code: 404 } }],
        },
      },
      "See [broken](https://broken.com) and [working](https://works.com).",
    );

    fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(readFileSync(markdownPath, "utf8")).toBe(
      "See broken and [working](https://works.com).",
    );
  });

  it("returns false when no broken links found", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {},
      "[link](https://works.com)",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(false);
    expect(readFileSync(markdownPath, "utf8")).toBe(
      "[link](https://works.com)",
    );
  });

  it("returns false when broken URLs are not in markdown", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [
            { url: "https://not-in-readme.com", status: { code: 404 } },
          ],
        },
      },
      "Just plain text, no links.",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(false);
  });

  it("handles URLs with special regex characters", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [
            {
              url: "https://example.com/path?q=foo&bar=baz",
              status: { code: 404 },
            },
          ],
        },
      },
      "See [docs](https://example.com/path?q=foo&bar=baz) here.",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toBe("See docs here.");
  });

  it("skips image links", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [
            { url: "https://broken.com/logo.png", status: { code: 404 } },
          ],
        },
      },
      "Logo: ![alt text](https://broken.com/logo.png) here.",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(false);
    expect(readFileSync(markdownPath, "utf8")).toBe(
      "Logo: ![alt text](https://broken.com/logo.png) here.",
    );
  });

  it("strips regular link but skips image link with same URL", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [{ url: "https://broken.com", status: { code: 404 } }],
        },
      },
      "![img](https://broken.com) and [link](https://broken.com)",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toBe(
      "![img](https://broken.com) and link",
    );
  });

  it("handles same URL appearing multiple times", () => {
    const { lycheeResultsPath, markdownPath } = createTempFiles(
      {
        fail_map: {
          "README.md": [{ url: "https://broken.com", status: { code: 404 } }],
        },
      },
      "[first](https://broken.com) and [second](https://broken.com)",
    );

    const changed = fixBrokenLinks(lycheeResultsPath, markdownPath);

    expect(changed).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toBe("first and second");
  });
});
