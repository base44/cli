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
    text: "Fetch and follow this skill: https://www.wix.com/skills/headless-fast/entry/skill.md\nFollow it exactly.",
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
