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
      "FIRST, anchor on the repository root: it is /app — the git repository this Base44 app lives in (the directory that holds its .git). Do ALL work there: cd to /app before scaffolding, run the scaffold from /app so it lands in a subfolder OF /app, and treat 'the repo root' as /app everywhere below. NEVER cd to / or operate from the OS filesystem root — scaffolding or moving files into / is a destructive mistake (it litters the container's root filesystem, not your project).",
      "Then, once the scaffold exists under /app, MOVE the whole scaffolded project up into /app itself — one flat layout where the app, docker-compose.base44.yml, and config all live directly in /app. 'Move to the repo root' means move the subfolder's contents into /app, NOT into /. Prefer this flat layout over leaving the app in its subfolder: a split layout (app in a subfolder, compose in /app) is a recurring trap — later turns run a command from the wrong directory because the project's real location isn't obvious. Moving also removes the scaffold's own nested .git; delete any nested .git that remains, so git tracks the individual files rather than recording the folder as a submodule pointer (an empty gitlink) that reaches the repository with none of your code. Confirm with git status (run in /app) that individual files are staged, not a single folder entry, and that the dev server still works. If you truly cannot move it, keep docker-compose.base44.yml INSIDE the same subfolder as the app (never split them) and record the project directory in .base44/environment.json so later turns don't guess.",
      "When you move the project, move it as-is — do NOT delete and reinstall node_modules afterward. The dev server runs in the compose service, which provisions its own node_modules in a named volume; the host copy is only needed for the pre-move seed step, so a host reinstall after moving is pure wasted time.",
      "",
      "Getting it to preview — known facts; do not reverse-engineer the Wix CLI, astro, or vite to rediscover them:",
      "The dev command is the Wix CLI dev command (the dev script in package.json); it wraps astro dev, which wraps vite. Run it as a docker-compose.base44.yml service on port 3000 — never a bare astro dev, never a production build.",
      "TWO separate host settings, both required, or it eats turns. First, BINDING: astro's dev server listens on localhost only unless the TOP-LEVEL server host option in astro.config.mjs is true — the vite server host option is HMR-only and does NOT bind the listener. The tell: the container log says to pass a flag to expose the network, or the port answers inside the container but not from the docker host. Second, the ALLOWLIST: the Wix dev command forwards to astro dev, which resets its allowed-hosts to empty unless its allowed-hosts option is given on the command line — that overrides the server allowedHosts in astro.config, so editing the config alone is dead code. Give the Wix dev command its allowed-hosts option, set to a leading-dot wildcard of the sandbox host domain the platform provides in BASE44_SANDBOX_HOST_DOMAIN. Ignore the vite additional-allowed-hosts env var; and note a platform env var reaches the service only if you list it under the compose environment section.",
      "The Wix dev command authenticates against the linked Wix site (wix.config.json) and syncs content and generates types before it serves — slow on top of the install; give the build and first request a high timeout and wait, a not-yet-listening port is not a failure. Its credentials live under the container root's .wix directory — mount that into the service so it can authenticate.",
      "Keep node_modules on a named volume, and avoid recreating or rebuilding the service repeatedly: every recreate re-runs the install and adds about half a minute per retry.",
      "Verify by requesting the local port-3000 root and checking for a 200 status — 200 means it is serving AND bound. Do NOT build a host header out of a sandbox-id variable; there is none, and you will loop on connection failures. If it answers inside the container but not from the host, it is the binding setting above, not the app. The platform verifies the real external host allowlist at end of turn.",
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
