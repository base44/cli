import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import { generateTypesFile, updateProjectConfig } from "@/core/types/index.js";
import { pathExists, writeFile } from "@/core/utils/fs.js";

function buildActorScaffold(actorName: string): string {
  return `import { Actor } from "base44:runtime/actors";
import type { ActorRegistry, Conn } from "@base44/sdk";

// Message types are generated from ./schema.jsonc by \`base44 types generate\` —
// the same source the client is typed from, so the two can't drift.
type Messages = ActorRegistry["${actorName}"];
type Incoming = Messages["toServer"];
type Outgoing = Messages["toClient"];

// The deploy bundler imports the actor as the entry's default export.
export default class ${actorName} extends Actor<Incoming, Outgoing> {
  handleConnect(conn: Conn<Outgoing>) {
    console.log("Connected:", conn.id);
  }
  handleMessage(conn: Conn<Outgoing>, msg: Incoming) {
    console.log("Message:", msg);
  }
  handleTick() {}
  handleClose(conn: Conn<Outgoing>) {}
}
`;
}

// Starter message catalog. Each message is a type-less object schema (the
// generator injects the \`type\` discriminant); shared shapes go under \`types\`
// and are referenced via #/types/<Name>.
function buildActorSchema(): string {
  return `{
  "types": {},
  // Messages this actor sends to clients (server → client).
  "toClient": {
    "welcome": {
      "properties": { "message": { "type": "string" } },
      "required": ["message"]
    }
  },
  // Messages clients send to this actor (client → server).
  "toServer": {
    "hello": {
      "properties": { "name": { "type": "string" } },
      "required": ["name"]
    }
  }
}
`;
}

async function newActorAction(
  _ctx: CLIContext,
  actorName: string,
): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();
  const actorsDir = join(dirname(project.configPath), project.actorsDir);
  const actorDir = join(actorsDir, actorName);

  if (await pathExists(actorDir)) {
    throw new InvalidInputError(
      `Actor "${actorName}" already exists at ${actorDir}`,
    );
  }

  const entryPath = join(actorDir, "entry.ts");
  await writeFile(entryPath, buildActorScaffold(actorName));
  await writeFile(join(actorDir, "schema.jsonc"), buildActorSchema());

  // Regenerate types so the scaffolded `base44:runtime/actors` import + the
  // schema-derived ActorRegistry types resolve immediately (re-read to pick up
  // the actor and its schema just written).
  const { entities, functions, agents, connectors, actors } =
    await readProjectConfig();
  await generateTypesFile({
    projectRoot: project.root,
    entities,
    functions,
    agents,
    connectors,
    actors,
  });
  await updateProjectConfig(project.root);

  return {
    outroMessage: `Created actor "${actorName}" at ${entryPath} — define its messages in schema.jsonc`,
  };
}

export function getNewCommand(): Command {
  return new Base44Command("new")
    .description("Create a new actor scaffold")
    .argument("<ActorName>", "Name of the actor class")
    .action(async (ctx: CLIContext, actorName: string) => {
      return newActorAction(ctx, actorName);
    });
}
