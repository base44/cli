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
      "Getting it to preview — take these as known facts, do NOT reverse-engineer @wix/cli, astro, or vite to rediscover them:",
      "- The dev command is the Wix CLI's `wix dev` (the `dev` script in package.json). It wraps `astro dev`, which wraps Vite. Run it as a docker-compose.base44.yml service on port 3000 — never a bare `astro dev`, never a production build.",
      "- TWO SEPARATE host settings, both required — this is what eats turns. (1) BINDING: astro's dev server binds localhost-only unless you set the TOP-LEVEL `server: { host: true }` in astro.config.mjs — NOT `vite.server.host` (that's only Vite/HMR and does NOT bind the dev server). If the container log says \"Network — use --host to expose\" or the port answers in-container but 000 from the host, this is why. (2) ALLOWLIST: `wix dev` forwards to `astro dev`, which sets `allowedHosts` to an EMPTY array unless `--allowed-hosts` is passed, OVERRIDING astro.config's `server.allowedHosts` (so editing the config alone is dead code). Pass the flag on the dev command: `npx wix dev --port 3000 --allowed-hosts .$BASE44_SANDBOX_HOST_DOMAIN` (leading dot = wildcard; the platform sets $BASE44_SANDBOX_HOST_DOMAIN). Don't chase the `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` env var — and note any platform env var only reaches the service if it's under compose `environment:`.",
      "- `wix dev` authenticates against the linked Wix site (wix.config.json) and syncs content + generates types before it serves — slow on top of the install. Give `up --build` and the first request a high timeout and wait; a not-yet-listening port is not a failure. The CLI credentials live at `/root/.wix` — mount that dir into the service so it can authenticate.",
      "- Keep node_modules on a named volume (or don't pass `--build`/recreate repeatedly): every recreate re-runs `npm install` and adds ~30s to each retry loop.",
      '- Verify with a plain `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` from the sandbox — 200 means it is serving AND bound to 0.0.0.0 (the whole point). Do NOT build a Host header out of a sandbox-id variable (there is none; you will loop on 000). If in-container curl is 200 but host curl is 000, it is the binding setting (1) above, not the app. The platform verifies the real external host allowlist at end of turn.',
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
