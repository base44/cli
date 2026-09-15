import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectConfig } from "@/core/project/config.js";
import { generateTypesFile } from "@/core/types/generator.js";

const fixtures = resolve(__dirname, "../fixtures");
const require = createRequire(import.meta.url);
const sdkTypes = require.resolve("@base44/sdk").replace(/\.js$/, ".d.ts");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function generateProject(mixed: boolean) {
  const root = await mkdtemp(join(tmpdir(), "base44-actor-types-"));
  tempDirs.push(root);
  await cp(join(fixtures, "with-actors"), root, { recursive: true });
  if (mixed)
    await cp(join(fixtures, "with-types-resources"), root, { recursive: true });
  const messagesPath = join(root, "base44/.types/actor-messages.d.ts");
  const messagesBefore = await readFile(messagesPath, "utf8");
  const { project, ...resources } = await readProjectConfig(root);
  await generateTypesFile({ projectRoot: project.root, ...resources });
  expect(await readFile(messagesPath, "utf8")).toBe(messagesBefore);
  return root;
}

function compile(root: string) {
  const program = ts.createProgram({
    rootNames: [
      join(root, "check-types.ts"),
      join(root, "base44/.types/types.d.ts"),
      join(root, "base44/.types/actor-messages.d.ts"),
    ],
    options: {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      skipLibCheck: true,
      types: [],
      paths: { "@base44/sdk": [sdkTypes] },
    },
  });
  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  expect(errors).toEqual([]);
}

describe("generated actor types", () => {
  it.each([
    false,
    true,
  ])("augments the SDK and preserves user declarations (mixed=%s)", async (mixed) => {
    compile(await generateProject(mixed));
  });
});
