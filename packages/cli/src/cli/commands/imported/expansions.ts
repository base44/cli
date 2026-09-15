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
