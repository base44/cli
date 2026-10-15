import { base44Client } from "@/core/clients/index.js";
import { ApiError } from "@/core/errors.js";

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
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: new Uint8Array(await response.arrayBuffer()),
    };
  } catch (error) {
    throw await ApiError.fromHttpError(error, `calling ${method} ${path}`);
  }
}
