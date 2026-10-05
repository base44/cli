import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import {
  displayName,
  getMe,
  MODELS,
  resolvePick,
  saveBuilderModel,
} from "@/core/model.js";

async function modelAction(
  { log, jsonMode }: CLIContext,
  input: string | undefined,
): Promise<RunCommandResult> {
  const me = await getMe();
  const current = me.builder_model ?? null;

  if (!input) {
    if (jsonMode) {
      return {
        stdout: `${JSON.stringify({
          current,
          models: MODELS.map((m) => ({ name: m.name, id: m.id })),
        })}\n`,
      };
    }
    for (const m of MODELS) {
      const active = (m.id ?? null) === current;
      const marker = active ? theme.styles.bold("●") : theme.styles.dim("○");
      const note = m.note ? theme.styles.dim(`  (${m.note})`) : "";
      log.message(
        `${marker} ${active ? theme.styles.bold(m.name) : m.name}${note}`,
      );
    }
    return {
      outroMessage: `Current: ${theme.styles.bold(displayName(current))}. Set with \`base44 builder model <name>\`.`,
    };
  }

  const pick = resolvePick(input);
  if ((pick.id ?? null) === current) {
    return { outroMessage: `Already on ${theme.styles.bold(pick.name)}.` };
  }
  await saveBuilderModel(me.id, pick.id);
  if (jsonMode) return { stdout: `${JSON.stringify({ current: pick.id })}\n` };
  return {
    outroMessage:
      pick.id === null
        ? "Model reset — Base44 chooses per app again."
        : `Builder model set to ${theme.styles.bold(pick.name)} for every new turn.`,
  };
}

export function getModelCommand(): Base44Command {
  const command = new Base44Command("model", { requireAppContext: false });
  command
    .description(
      "Pick the builder model for your turns (account-wide). No argument lists models and the current pick; `default` clears it",
    )
    .argument("[model]", 'Model name or id, e.g. "Opus 5" or default')
    .action(modelAction);
  return command;
}
