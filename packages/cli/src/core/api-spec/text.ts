// Docs-site markup: Mintlify callouts and links relative to the docs site.
const DOCS_CALLOUT = /<(Info|Note|Tip|Check|Warning)>([\s\S]*?)<\/\1>/g;
const RELATIVE_LINK = /\[([^\]]+)\]\(\/[^)]*\)/g;

/** Description text without docs-site markup an agent can't use. */
export function cleanText(text: string): string {
  return text
    .replace(DOCS_CALLOUT, (_, kind: string, body: string) =>
      kind === "Warning" ? `Warning: ${body}` : body,
    )
    .replace(RELATIVE_LINK, "$1");
}
