import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  AgentSkill,
  ListAgentSkillsResponse,
  SyncAgentSkillsResult,
} from "./schema.js";
import { ListAgentSkillsResponseSchema } from "./schema.js";

export async function fetchAgentSkills(): Promise<ListAgentSkillsResponse> {
  const appClient = getAppClient();
  let response: KyResponse;
  try {
    response = await appClient.get("agent-skills");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching agent skills");
  }
  const result = ListAgentSkillsResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

export async function pushAgentSkills(
  skills: AgentSkill[],
): Promise<SyncAgentSkillsResult> {
  if (skills.length === 0) {
    return { created: [], updated: [], deleted: [] };
  }

  const appClient = getAppClient();
  const remote = await fetchAgentSkills();
  const remoteByName = new Map(remote.items.map((s) => [s.name, s]));
  const localNames = new Set(skills.map((s) => s.name));

  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];

  try {
    for (const skill of skills) {
      const prev = remoteByName.get(skill.name);
      if (!prev) {
        await appClient.post("agent-skills", { json: skill });
        created.push(skill.name);
      } else if (
        prev.description !== skill.description ||
        prev.body !== skill.body
      ) {
        await appClient.put(`agent-skills/${skill.name}`, {
          json: { description: skill.description, body: skill.body },
        });
        updated.push(skill.name);
      }
    }
    for (const remoteSkill of remote.items) {
      if (!localNames.has(remoteSkill.name)) {
        await appClient.delete(`agent-skills/${remoteSkill.name}`);
        deleted.push(remoteSkill.name);
      }
    }
  } catch (error) {
    throw await ApiError.fromHttpError(error, "syncing agent skills");
  }

  return { created, updated, deleted };
}
