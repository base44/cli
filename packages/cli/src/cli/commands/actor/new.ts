import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import { pathExists, writeFile } from "@/core/utils/fs.js";

function buildActorScaffold(actorName: string): string {
  return `import { Actor, type Conn } from "@base44/sdk";

interface State {
  // shared state broadcast to all clients
}

interface Message {
  // messages sent from clients
}

export class ${actorName} extends Actor<State, Message> {
  handleConnect(conn: Conn) {
    console.log("Connected:", conn.userId);
  }
  handleMessage(conn: Conn, msg: Message) {
    console.log("Message:", msg);
  }
  handleTick() {}
  handleClose(conn: Conn) {}
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
