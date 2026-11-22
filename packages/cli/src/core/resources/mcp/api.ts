import { HTTPError, type KyResponse } from "ky";
import { base44Client } from "@/core/clients/index.js";
import {
  ApiError,
  type ErrorHint,
  SchemaValidationError,
} from "@/core/errors.js";
import { getAppContext } from "@/core/project/index.js";
import {
  type McpConfig,
  McpConfigResponseSchema,
  type McpConfigState,
  McpErrorEnvelopeSchema,
} from "./schema.js";

/**
 * Under `api/apps/platform/`, not the app client's `api/apps/{app_id}/` prefix,
 * so this goes through the platform client with the full path.
 */
function mcpConfigPath(): string {
  return `api/apps/platform/${getAppContext().id}/mcp/config`;
}

const HINTS_BY_CODE: Record<string, ErrorHint[]> = {
  changes_through_versions: [
    {
      message:
        "This app ships through versions; its MCP config is published with the app, not pushed on its own.",
    },
  ],
  mcp_config_in_app_source: [
    {
      message:
        "This app's MCP config lives in its source files; change it in the Base44 builder.",
    },
  ],
};

/**
 * Like {@link ApiError.fromHttpError}, but reads the platform's
 * `{error: {code, message}}` envelope, whose message is the reason a config
 * was refused (the generic reader would print the envelope as JSON). Errors in
 * the older shape (403/404 from the access check, 422, 429) fall through.
 */
async function toMcpApiError(
  error: unknown,
  context: string,
): Promise<ApiError> {
  const fallback = await ApiError.fromHttpError(error, context);
  const envelope = McpErrorEnvelopeSchema.safeParse(fallback.responseBody);
  if (!(error instanceof HTTPError) || !envelope.success) {
    return fallback;
  }
  const { code, message } = envelope.data.error;
  const text = message ?? code;
  if (!text) {
    return fallback;
  }
  return new ApiError(
    `Error ${context}: ${text}${code && message ? ` (${code})` : ""}`,
    {
      statusCode: fallback.statusCode,
      requestUrl: fallback.requestUrl,
      requestMethod: fallback.requestMethod,
      requestBody: fallback.requestBody,
      responseBody: fallback.responseBody,
      requestId: fallback.requestId,
      hints: (code && HINTS_BY_CODE[code]) || [],
      cause: error,
    },
  );
}

function parseState(body: unknown): McpConfigState {
  const result = McpConfigResponseSchema.safeParse(body);
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

/**
 * Fetches the app's MCP config and its resolved surface.
 */
export async function getMcpConfig(): Promise<McpConfigState> {
  let response: KyResponse;
  try {
    response = await base44Client.get(mcpConfigPath());
  } catch (error) {
    throw await toMcpApiError(error, "fetching MCP config");
  }
  return parseState(await response.json());
}

/**
 * Replaces the app's MCP config. Live on return. `null` deletes the config and
 * takes the app's MCP server down.
 */
export async function putMcpConfig(
  config: McpConfig | null,
): Promise<McpConfigState> {
  let response: KyResponse;
  try {
    response = await base44Client.put(mcpConfigPath(), { json: { config } });
  } catch (error) {
    throw await toMcpApiError(
      error,
      config === null ? "removing MCP config" : "pushing MCP config",
    );
  }
  return parseState(await response.json());
}
