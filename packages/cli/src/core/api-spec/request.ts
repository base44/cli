import { HTTPError } from "ky";
import { base44Client } from "@/core/clients/index.js";
import { ApiError } from "@/core/errors.js";

const MAX_ERROR_BODY_CHARS = 4000;

async function readBody(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.clone().text()).trim();
    return text.length > MAX_ERROR_BODY_CHARS
      ? `${text.slice(0, MAX_ERROR_BODY_CHARS)}…`
      : text || undefined;
  } catch {
    return undefined;
  }
}

export interface ApiResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

/** Send a request as is through the authenticated client; the server validates it. */
export async function sendApiRequest(
  method: string,
  path: string,
  body?: string,
): Promise<ApiResponse> {
  try {
    const response = await base44Client(path.replace(/^\/+/, ""), {
      method,
      body,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      // The call may be a long deploy; the built-in commands wait as long.
      timeout: false,
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: new Uint8Array(await response.arrayBuffer()),
    };
  } catch (error) {
    const apiError = await ApiError.fromHttpError(
      error,
      `calling ${method} ${path}`,
    );
    // Any endpoint can carry secrets, so neither body goes to error reporting;
    // the server's raw reply is shown to the caller instead.
    const raw =
      error instanceof HTTPError ? await readBody(error.response) : undefined;
    // With the raw reply in the details, the message names only the status,
    // so the server's words are printed once.
    const message =
      raw && apiError.statusCode !== undefined
        ? `Error calling ${method} ${path}: HTTP ${apiError.statusCode}`
        : apiError.message;
    throw new ApiError(message, {
      statusCode: apiError.statusCode,
      requestUrl: apiError.requestUrl,
      requestMethod: apiError.requestMethod,
      requestId: apiError.requestId,
      hints: apiError.hints,
      details: raw ? [`Response body: ${raw}`] : apiError.details,
    });
  }
}
