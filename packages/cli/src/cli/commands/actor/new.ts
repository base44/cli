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
import type { Conn } from "@base44/sdk";

interface Incoming {
  // messages clients send to this actor (schema toServer)
}

interface Outgoing {
  // messages this actor sends to clients (schema toClient)
}

export class ${actorName} extends Actor<Incoming, Outgoing> {
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

  // Regenerate types so the scaffolded `base44:runtime/actors` import resolves
  // in the editor immediately (re-read to pick up the actor just written).
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
    outroMessage: `Created actor "${actorName}" at ${entryPath}`,
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
