import type { KyResponse } from "ky";
import { base44Client, getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/index.js";
import type { AppSlug, UpdateSlugRequest } from "./schema.js";
import { AppSlugResponseSchema, SlugSuggestionsSchema } from "./schema.js";

/** Fetch the app's current slug (from the app document). */
export async function getSlug(): Promise<AppSlug> {
  const { id } = getAppContext();

  let response: KyResponse;
  try {
    response = await base44Client.get(`api/apps/${id}`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching app slug");
  }

  const result = AppSlugResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

/**
 * Change the app's slug; pass null to reset to the auto-generated slug.
 * When the requested slug is already in use, the API's alternative
 * suggestions are surfaced as hints on the thrown ApiError.
 */
export async function updateSlug(slug: string | null): Promise<AppSlug> {
  const appClient = getAppClient();

  const request: UpdateSlugRequest = { slug };
  let response: KyResponse;
  try {
    response = await appClient.patch("metadata/slug", { json: request });
  } catch (error) {
    const apiError = await ApiError.fromHttpError(error, "updating slug");
    const suggestions = SlugSuggestionsSchema.safeParse(apiError.responseBody)
      .data?.suggestions;
    if (suggestions && suggestions.length > 0) {
      apiError.hints.unshift({
        message: `Available alternatives: ${suggestions.join(", ")}`,
      });
    }
    throw apiError;
  }

  const result = AppSlugResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}
