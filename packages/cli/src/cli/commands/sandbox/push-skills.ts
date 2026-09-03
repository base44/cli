import type { Option as PromptOption } from "@clack/prompts";
import { isCancel, multiselect } from "@clack/prompts";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, onPromptCancel } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/index.js";
import type { CopySkillResult, LocalSkill } from "@/core/skills/index.js";
import {
  copySkill,
  discoverLocalSkills,
  SKILLS_DEST_DIR,
} from "@/core/skills/index.js";
import { toJsonStdout } from "./shared.js";

const HINT_DESCRIPTION_LENGTH = 60;

interface PushSkillsOptions {
  name?: string[];
  all?: boolean;
  overwrite?: boolean;
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max
    ? `${collapsed.slice(0, max - 1).trimEnd()}…`
    : collapsed;
}

/**
 * Show the frontmatter name next to the directory name so a mismatch between
 * the two is visible rather than silently resolved -- the directory name is
 * what the skill is copied as.
 */
function buildHint(skill: LocalSkill): string | undefined {
  const parts = [
    skill.name && skill.name !== skill.dirName ? skill.name : "",
    skill.description
      ? truncate(skill.description, HINT_DESCRIPTION_LENGTH)
      : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function selectByName(skills: LocalSkill[], names: string[]): LocalSkill[] {
  const byDirName = new Map(skills.map((skill) => [skill.dirName, skill]));
  const unknown = names.filter((name) => !byDirName.has(name));
  if (unknown.length > 0) {
    throw new InvalidInputError(
      `No such skill: ${unknown.join(", ")}. Found: ${skills
        .map((skill) => skill.dirName)
        .join(", ")}.`,
    );
  }
  // Preserve discovery order rather than the order the flags were passed.
  return skills.filter((skill) => names.includes(skill.dirName));
}

/**
 * `null` is the "all skills" entry. Using null rather than a sentinel string
 * means it can never collide with a real directory name.
 */
async function promptForSkills(skills: LocalSkill[]): Promise<LocalSkill[]> {
  const options: PromptOption<string | null>[] = [
    { value: null, label: "All skills", hint: `${skills.length} found` },
    ...skills.map((skill) => ({
      value: skill.dirName,
      label: skill.dirName,
      hint: buildHint(skill),
    })),
  ];

  const picked = await multiselect<string | null>({
    message: "Which skills do you want to copy?",
    options,
    required: true,
  });
  if (isCancel(picked)) {
    onPromptCancel();
  }

  const selected = picked as (string | null)[];
  if (selected.includes(null)) {
    return skills;
  }
  return skills.filter((skill) => selected.includes(skill.dirName));
}

async function resolveSelection(
  skills: LocalSkill[],
  options: PushSkillsOptions,
  isNonInteractive: boolean,
): Promise<LocalSkill[]> {
  const named = options.name ?? [];
  if (options.all && named.length > 0) {
    throw new InvalidInputError(
      "Pass either --all or --name, not both. --name would otherwise silently narrow --all to a subset.",
    );
  }
  if (named.length > 0) {
    return selectByName(skills, named);
  }
  if (options.all || skills.length === 1) {
    return skills;
  }
  // Mirrors confirmPush: never leave --json or CI waiting on a prompt.
  if (isNonInteractive) {
    throw new InvalidInputError(
      `Found ${skills.length} skills. Pass --all or --name <name> to choose in non-interactive mode.`,
    );
  }
  return await promptForSkills(skills);
}

function reportBinarySkips(
  log: CLIContext["log"],
  results: CopySkillResult[],
): void {
  const skipped = results.flatMap((result) =>
    result.skippedBinary.map((path) => `${result.skill}/${path}`),
  );
  if (skipped.length === 0) {
    return;
  }
  log.warn(
    [
      "Binary files are not supported by the sandbox bridge and were not copied:",
      ...skipped.map((path) => `    ${path}`),
      "  The rest of the skill was copied. Remove them or replace them with text",
      "  equivalents if the skill depends on them.",
    ].join("\n"),
  );
}

async function pushSkillsAction(
  { isNonInteractive, jsonMode, log, runTask }: CLIContext,
  dir: string,
  options: PushSkillsOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();

  const skills = await discoverLocalSkills(dir);
  const selected = await resolveSelection(
    skills,
    options,
    isNonInteractive || jsonMode,
  );

  const results: CopySkillResult[] = [];
  for (const skill of selected) {
    const result = await runTask(
      `Copying ${skill.dirName}`,
      () => copySkill(appId, skill, { overwrite: options.overwrite }),
      {
        successMessage: `Copied ${skill.dirName}`,
        errorMessage: `Failed to copy ${skill.dirName}`,
      },
    );
    results.push(result);
  }

  const fileCount = results.reduce(
    (total, result) => total + result.written.length,
    0,
  );
  log.success(
    `Copied ${results.length} skill(s): ${results
      .map((result) => result.skill)
      .join(", ")}`,
  );
  reportBinarySkips(log, results);

  return {
    outroMessage: `Copied ${fileCount} file(s) to ${SKILLS_DEST_DIR}`,
    // Automation needs to know exactly what landed and what was dropped; the
    // binary warning above only reaches stderr.
    ...(jsonMode
      ? {
          stdout: toJsonStdout({
            destination: SKILLS_DEST_DIR,
            skills: results,
          }),
        }
      : {}),
  };
}

export function getSandboxPushSkillsCommand(): Command {
  return new Base44Command("push-skills")
    .description(
      `Copy local agent skills into an app's remote sandbox (${SKILLS_DEST_DIR})`,
    )
    .argument("<dir>", "Local skill directory, or a directory of skills")
    .option(
      "--name <name...>",
      "Copy only these skills, by directory name (skips the picker)",
    )
    .option("--all", "Copy every discovered skill (skips the picker)")
    .option("--overwrite", "Overwrite files that already exist in the sandbox")
    .addHelpText(
      "after",
      `
Examples:
  $ base44 sandbox push-skills ~/.claude/skills --app-id app_123
  $ base44 sandbox push-skills ./.claude/skills/deploy-check --overwrite
  $ base44 sandbox push-skills ~/.claude/skills --name grill-me --name tidy-up`,
    )
    .action(pushSkillsAction);
}
