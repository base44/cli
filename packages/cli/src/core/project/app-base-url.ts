import { ApiError } from "@/core/errors.js";
import { getSiteUrl } from "@/core/project/api.js";

const appPreviewUrl = (appId: string) => `https://preview--${appId}.base44.app`;

const isAppNotPublished = (error: unknown) =>
  error instanceof ApiError && error.statusCode === 404;

export async function resolveAppBaseUrl(appId: string) {
  try {
    return await getSiteUrl();
  } catch (error) {
    if (isAppNotPublished(error)) return appPreviewUrl(appId);
    throw error;
  }
}
