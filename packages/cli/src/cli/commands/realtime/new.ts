import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import { pathExists, writeFile } from "@/core/utils/fs.js";

function buildHandlerScaffold(handlerName: string): string {
  return `import { RealtimeHandler, type Conn } from "@base44/sdk";

export class ${handlerName} extends RealtimeHandler {
  handleConnect(conn: Conn) {
    console.log("Connected:", conn.userId);
  }
  handleMessage(conn: Conn, msg: unknown) {
    console.log("Message:", msg);
  }
  handleTick() {}
  handleClose(conn: Conn) {}
}
`;
}

async function newRealtimeHandlerAction(
  _ctx: CLIContext,
  handlerName: string,
): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();
  const realtimeDir = join(dirname(project.configPath), project.realtimeDir);
  const handlerDir = join(realtimeDir, handlerName);

  if (await pathExists(handlerDir)) {
    throw new InvalidInputError(
      `Realtime handler "${handlerName}" already exists at ${handlerDir}`,
    );
  }

  const entryPath = join(handlerDir, "entry.ts");
  await writeFile(entryPath, buildHandlerScaffold(handlerName));

  return {
    outroMessage: `Created realtime handler "${handlerName}" at ${entryPath}`,
  };
}

export function getNewCommand(): Command {
  return new Base44Command("new")
    .description("Create a new realtime handler scaffold")
    .argument("<HandlerName>", "Name of the realtime handler class")
    .action(async (ctx: CLIContext, handlerName: string) => {
      return newRealtimeHandlerAction(ctx, handlerName);
    });
}
