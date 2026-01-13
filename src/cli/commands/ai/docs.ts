import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log, multiselect, confirm } from "@clack/prompts";
import { pathExists, writeFile } from "@core/utils/fs.js";
import { runCommand, runTask } from "../../utils/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Read the AGENTS.md file from the CLI repository root
 */
async function readAgentsMd(): Promise<string> {
  // Go up from src/cli/commands/ai/docs.ts to reach the root
  const agentsMdPath = join(__dirname, "../../../../AGENTS.md");

  if (!(await pathExists(agentsMdPath))) {
    throw new Error("AGENTS.md file not found in the repository");
  }

  return await readFile(agentsMdPath, "utf-8");
}

/**
 * Generate CLAUDE.md content from AGENTS.md
 * Extracts relevant sections and adds Claude-specific guidelines
 */
function generateClaudeMd(agentsMdContent: string): string {
  // Extract the main sections from AGENTS.md
  const sections = [
    "Project Overview",
    "Folder Structure",
    "Adding a New Command",
    "Making API Calls",
    "Resource Pattern",
    "Path Aliases",
    "Important Rules",
    "Development",
  ];

  let claudeContent = "# Claude Guidelines for Base44 CLI Development\n\n";
  claudeContent += "This file contains guidelines for Claude when working on the Base44 CLI project.\n\n";
  claudeContent += "**Important**: Follow these guidelines carefully when making changes to this project.\n\n";

  // Extract each section from AGENTS.md
  for (const section of sections) {
    const sectionRegex = new RegExp(`## ${section}[\\s\\S]*?(?=\\n## |$)`, "m");
    const match = agentsMdContent.match(sectionRegex);
    if (match) {
      claudeContent += match[0] + "\n";
    }
  }

  // Add Claude-specific notes
  claudeContent += "\n## Claude-Specific Notes\n\n";
  claudeContent += "- Always read existing files before modifying them\n";
  claudeContent += "- Use the project's established patterns and conventions\n";
  claudeContent += "- Follow the TypeScript and ESLint configurations\n";
  claudeContent += "- Test changes thoroughly before committing\n";
  claudeContent += "- Keep this file updated when making architectural changes\n";

  return claudeContent;
}

/**
 * Generate .cursorrules content from AGENTS.md
 * Creates concise rules for Cursor IDE
 */
function generateCursorRules(agentsMdContent: string): string {
  let cursorRules = "# Base44 CLI - Cursor Rules\n\n";

  // Extract key patterns from AGENTS.md
  cursorRules += "## Tech Stack\n";
  cursorRules += "- TypeScript with ES Modules\n";
  cursorRules += "- Commander.js for CLI\n";
  cursorRules += "- @clack/prompts for UI\n";
  cursorRules += "- Zod for validation\n";
  cursorRules += "- tsdown for bundling\n\n";

  cursorRules += "## Key Rules\n";

  // Extract important rules
  const rulesSection = agentsMdContent.match(/## Important Rules[\s\S]*?(?=\n## |$)/m);
  if (rulesSection) {
    const rules = rulesSection[0].match(/^\d+\.\s+\*\*[^*]+\*\*[^\n]+/gm);
    if (rules) {
      rules.forEach((rule) => {
        cursorRules += rule.replace(/^\d+\.\s+/, "- ") + "\n";
      });
    }
  }

  cursorRules += "\n## Path Alias\n";
  cursorRules += "- Use `@core/*` for core module imports\n";
  cursorRules += "- Always use `.js` extensions in imports\n\n";

  cursorRules += "## Command Pattern\n";
  cursorRules += "```typescript\n";
  cursorRules += "import { Command } from \"commander\";\n";
  cursorRules += "import { runCommand, runTask } from \"../../utils/index.js\";\n\n";
  cursorRules += "async function myAction(): Promise<void> {\n";
  cursorRules += "  await runTask(\"Task description\", async () => {\n";
  cursorRules += "    // Implementation\n";
  cursorRules += "  });\n";
  cursorRules += "}\n\n";
  cursorRules += "export const myCommand = new Command(\"name\")\n";
  cursorRules += "  .description(\"Description\")\n";
  cursorRules += "  .action(async () => await runCommand(myAction));\n";
  cursorRules += "```\n\n";

  cursorRules += "## API Calls\n";
  cursorRules += "```typescript\n";
  cursorRules += "import { base44Client, getAppClient } from \"@core/api/index.js\";\n";
  cursorRules += "const response = await base44Client.get(\"api/endpoint\");\n";
  cursorRules += "```\n";

  return cursorRules;
}

/**
 * Main function to generate AI documentation
 */
async function generateAiDocs(): Promise<void> {
  log.info("This command generates AI-specific documentation for your Base44 CLI project.\n");

  // Read AGENTS.md
  const agentsMdContent = await runTask(
    "Reading AGENTS.md file",
    async () => await readAgentsMd(),
    {
      successMessage: "AGENTS.md loaded",
      errorMessage: "Failed to read AGENTS.md",
    }
  );

  // Ask which files to generate
  const selectedFiles = await multiselect({
    message: "Which AI documentation files would you like to generate?",
    options: [
      {
        value: "agents",
        label: "AGENTS.md",
        hint: "Comprehensive guidelines for all AI agents",
      },
      {
        value: "claude",
        label: "CLAUDE.md",
        hint: "Focused guidelines for Claude Code/Claude Dev",
      },
      {
        value: "cursor",
        label: ".cursorrules",
        hint: "Concise rules for Cursor IDE",
      },
    ],
    required: true,
  });

  if (typeof selectedFiles === "symbol") {
    log.warn("Operation cancelled");
    return;
  }

  const files = selectedFiles as string[];

  if (files.length === 0) {
    log.warn("No files selected");
    return;
  }

  // Generate and write selected files
  const cwd = process.cwd();

  for (const fileType of files) {
    let filePath: string;
    let content: string;
    let fileName: string;

    switch (fileType) {
      case "agents":
        filePath = join(cwd, "AGENTS.md");
        content = agentsMdContent;
        fileName = "AGENTS.md";
        break;
      case "claude":
        filePath = join(cwd, "CLAUDE.md");
        content = generateClaudeMd(agentsMdContent);
        fileName = "CLAUDE.md";
        break;
      case "cursor":
        filePath = join(cwd, ".cursorrules");
        content = generateCursorRules(agentsMdContent);
        fileName = ".cursorrules";
        break;
      default:
        continue;
    }

    // Check if file exists and ask for confirmation
    if (await pathExists(filePath)) {
      const shouldOverwrite = await confirm({
        message: `${fileName} already exists. Overwrite?`,
        initialValue: false,
      });

      if (typeof shouldOverwrite === "symbol" || !shouldOverwrite) {
        log.info(`Skipped ${fileName}`);
        continue;
      }
    }

    // Write the file
    await runTask(
      `Writing ${fileName}`,
      async () => await writeFile(filePath, content),
      {
        successMessage: `${fileName} created successfully`,
        errorMessage: `Failed to write ${fileName}`,
      }
    );
  }

  log.success("\nAI documentation files generated successfully!");
  log.info("\nThese files help AI assistants understand your project structure and conventions.");
}

export const aiDocsCommand = new Command("ai")
  .description("Generate AI-specific documentation files (AGENTS.md, CLAUDE.md, .cursorrules)")
  .command("docs")
  .description("Generate AI documentation for the project")
  .action(async () => {
    await runCommand(generateAiDocs);
  });
