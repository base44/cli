import { HTTPError } from "ky";
import { base44Client } from "./clients/index.js";
import { ApiError, InvalidInputError } from "./errors.js";

/**
 * Main customer-facing builder models, mirroring the web model picker's customer
 * set (modelPickerRegistry). Name shown to the user -> backend picker id; the
 * backend validates the id and the workspace entitlement per turn, so a pick it
 * rejects surfaces as a clear error rather than a silent fallback. Notes are
 * the web picker's own copy. "Automatic" clears the pick (builder_model = null);
 * `default` and `auto` are accepted as typed aliases for it.
 */
export const MODELS: {
  name: string;
  id: string | null;
  note?: string;
  aliases?: string[];
}[] = [
  {
    name: "Automatic",
    id: null,
    note: "matched with the best model",
    aliases: ["default", "auto"],
  },
  { name: "Opus 5", id: "claude_opus_5" },
  { name: "Sonnet 5", id: "claude-sonnet-5" },
  { name: "Fable 5", id: "claude_fable_5", note: "uses more credits" },
  { name: "GPT-5.6 Sol", id: "gpt_5_6_sol" },
  {
    name: "Gemini 3.8 Flash",
    id: "gemini_3_8_flash",
    note: "fast responses for everyday tasks",
  },
  { name: "Base 1", id: "base1" },
];

/** Fold a name or id to a comparable key: lowercase, drop every non-alphanumeric
 *  so "Opus 5", "opus-5", "opus_5" and "claude_opus_5" all match sensibly. */
const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function resolvePick(input: string): (typeof MODELS)[number] {
  const key = fold(input);
  const byExact = MODELS.find(
    (m) =>
      fold(m.name) === key ||
      (m.id && fold(m.id) === key) ||
      m.aliases?.some((a) => fold(a) === key),
  );
  if (byExact) return byExact;
  // Loose contains: "opus" -> Opus 5, "gemini" -> Gemini 3.8 Flash.
  const byContains = MODELS.filter(
    (m) => fold(m.name).includes(key) || (m.id && fold(m.id).includes(key)),
  );
  if (byContains.length === 1) return byContains[0];
  const names = MODELS.map((m) => m.name).join(", ");
  throw new InvalidInputError(
    byContains.length > 1
      ? `"${input}" is ambiguous — matches ${byContains.map((m) => m.name).join(", ")}.`
      : `Unknown model "${input}". Choose one of: ${names}.`,
  );
}

interface MeResponse {
  id: string;
  builder_model?: string | null;
}

export async function getMe(): Promise<MeResponse> {
  try {
    return await base44Client.get("api/auth/me").json<MeResponse>();
  } catch (error) {
    throw await ApiError.fromHttpError(error, "reading your account");
  }
}

export async function saveBuilderModel(
  userId: string,
  modelId: string | null,
): Promise<void> {
  try {
    await base44Client.post(`api/auth/${userId}/update-user`, {
      json: { builder_model: modelId },
    });
  } catch (error) {
    // Model selection is enabled per account server-side; a 400 here means the
    // account lacks it (or the model isn't runnable in this workspace).
    if (error instanceof HTTPError && error.response.status === 400) {
      throw new InvalidInputError(
        "This account can't pick a builder model yet, or the model isn't available in this workspace. Ask your workspace admin to enable model selection.",
      );
    }
    throw await ApiError.fromHttpError(error, "saving your model choice");
  }
}

/** Display name for a stored builder_model id (may be one the CLI doesn't list). */
export const displayName = (id: string | null | undefined): string =>
  MODELS.find((m) => m.id === id)?.name ?? id ?? "Automatic";
