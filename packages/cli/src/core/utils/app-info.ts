import { base44Client, getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { getAppConfig } from "@/core/project/index.js";
import { PublishedUrlResponseSchema } from "@/core/site/schema.js";

export async function getAppUserToken(): Promise<string> {
  try {
    const response = await getAppClient()
      .get("auth/token")
      .json<{ token: string }>();
    return response.token;
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      "exchanging platform token for app user token",
    );
  }
}

export async function getSiteUrl(projectId?: string): Promise<string> {
  const id = projectId ?? getAppConfig().id;

  let response;
  try {
    response = await base44Client.get(`api/apps/platform/${id}/published-url`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching site URL");
  }

  const result = PublishedUrlResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data.url;
}
