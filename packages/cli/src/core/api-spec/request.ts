import { base44Client } from "@/core/clients/index.js";
import { ApiError } from "@/core/errors.js";

/** Send a request as is through the authenticated client; the server validates it. */
export async function sendApiRequest(
  method: string,
  path: string,
  body?: string,
): Promise<string> {
  try {
    const response = await base44Client(path.replace(/^\/+/, ""), {
      method,
      body,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    });
    return await response.text();
  } catch (error) {
    throw await ApiError.fromHttpError(error, `calling ${method} ${path}`);
  }
}
