/** Prompt expansions: a `/name` token in a prompt swaps for a canned block of
 * instructions. Hardcoded registry for now — a config file can replace it
 * later without touching the call sites. */

interface PromptExpansion {
  description: string;
  text: string;
}

const PROMPT_EXPANSIONS: Record<string, PromptExpansion> = {
  headless: {
    description: "Build with the Wix Headless Fast skill",
    // Deliberately no shell syntax (`curl -fsSL …`): the platform edge WAF
    // rejects command-shaped request bodies; the agent fetches URLs itself.
    // The nested-git note prevents the scaffold from committing as a gitlink.
    text: [
      "Fetch and follow this skill: https://www.wix.com/skills/headless-fast/entry/skill.md",
      "Follow it exactly.",
      "",
      "One repository — this is important. The skill scaffolds the site into a subfolder named after the business (via `npm create @wix/new`), and that generator initializes its own git repository (a `.git`) inside the new subfolder. But this Base44 app is already a single git repository, and it commits and pushes your work automatically at the end of the turn. A nested `.git` breaks that: git records the whole scaffolded subfolder as a submodule pointer (an empty gitlink) instead of its files, so none of your code reaches the repository.",
      "So once the scaffold exists, collapse it into this one repository before you finish: delete the scaffolded subfolder's `.git` directory (e.g. `rm -rf <folder>/.git`) so its files are tracked here — or move the project up to the repository root. Then confirm with `git status` that the subfolder's individual files are staged, not the folder appearing as a single submodule entry. Keep the dev server and everything else working after the move.",
      "",
      "Getting it to preview — take these as known facts, don't rediscover them:",
      "- The dev command is the Wix CLI's `wix dev` (it wraps Astro's dev server, and is the `dev` script in package.json). Run that as a docker-compose.base44.yml service published on port 3000 — never a bare `astro dev` and never a production build.",
      "- The preview shows whatever serves on port 3000, but `wix dev`/Astro bind localhost and reject foreign hosts by default. In astro.config.mjs set `vite: { server: { host: true, allowedHosts: true } }` (bind 0.0.0.0 and allow ALL hosts — never a single exact host), so the sandbox's rotating external hostname is accepted.",
      "- `wix dev` authenticates against the linked Wix site (wix.config.json) and syncs content and generates types before it serves — so first boot is slow on top of the dependency install. Give `docker compose ... up --build` and the first request a high timeout and wait, rather than reading the not-yet-listening port as a failure. If the CLI can't authenticate in the container, make its credentials/config available to the service.",
      "- Verify by curling the port-3000 entry point (with the preview Host header) until it returns real HTML. The in-editor preview screenshot / verify tools are NOT available for imported apps in this environment — do not call them or wait on them; a healthy curl is the signal that the preview is live.",
    ].join("\n"),
  },
};

interface ExpandedPrompt {
  text: string;
  /** Names of the expansions that were applied, in order. */
  applied: string[];
}

const TOKEN_RE = /(^|\s)\/([a-z][\w-]*)\b/g;

/** Replace known `/name` tokens with their expansion blocks (appended after
 * the prompt). Unknown tokens pass through untouched. Idempotent: applied
 * tokens are removed, and expansion text carries none. */
export function expandPrompt(prompt: string): ExpandedPrompt {
  const applied: string[] = [];
  const cleaned = prompt
    .replace(TOKEN_RE, (match, lead: string, name: string) => {
      if (!PROMPT_EXPANSIONS[name]) return match;
      applied.push(name);
      return lead ? " " : "";
    })
    .replace(/\s+/g, " ")
    .trim();
  if (applied.length === 0) return { text: prompt, applied };
  const blocks = applied.map((name) => PROMPT_EXPANSIONS[name].text);
  return { text: [cleaned, ...blocks].join("\n\n"), applied };
}
