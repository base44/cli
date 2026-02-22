import type { RequestHandler } from "msw";
import { HttpResponse, http } from "msw";
import { mswServer } from "./index.js";

const BASE_URL = "https://app.base44.com";

// ─── RESPONSE TYPES ──────────────────────────────────────────

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface UserInfoResponse {
  email: string;
  name?: string;
}

interface EntitiesPushResponse {
  created: string[];
  updated: string[];
  deleted: string[];
}

interface FunctionsPushResponse {
  deployed: string[];
  deleted: string[];
  errors: Array<{ name: string; message: string }> | null;
}

interface SiteDeployResponse {
  app_url: string;
}

interface SiteUrlResponse {
  url: string;
}

interface AgentsPushResponse {
  created: string[];
  updated: string[];
  deleted: string[];
}

interface AgentsFetchResponse {
  items: Array<{ name: string; [key: string]: unknown }>;
  total: number;
}

interface FunctionLogEntry {
  time: string;
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
}

type FunctionLogsResponse = FunctionLogEntry[];

interface ConnectorsListResponse {
  integrations: Array<{
    integration_type: string;
    status: string;
    scopes: string[];
    user_email?: string;
  }>;
}

interface ConnectorSetResponse {
  redirect_url: string | null;
  connection_id: string | null;
  already_authorized: boolean;
  error?: "different_user";
  error_message?: string;
  other_user_email?: string;
}

interface ConnectorRemoveResponse {
  status: "removed";
  integration_type: string;
}

interface CreateAppResponse {
  id: string;
  name: string;
}

interface ListProjectsResponse {
  id: string;
  name: string;
  user_description?: string | null;
  is_managed_source_code?: boolean;
}

interface ErrorResponse {
  status: number;
  body?: unknown;
}

// ─── MOCK CLASS ──────────────────────────────────────────────

/**
 * Typed API mock for Base44 endpoints.
 *
 * Method naming convention:
 * - `mock<Resource>()` - Mock successful response
 * - `mock<Resource>Error()` - Mock error response
 *
 * @example
 * ```typescript
 * // Success responses
 * api.mockEntitiesPush({ created: ["User"], updated: [], deleted: [] });
 * api.mockAgentsFetch({ items: [{ name: "support" }], total: 1 });
 *
 * // Error responses
 * api.mockEntitiesPushError({ status: 500, body: { error: "Server error" } });
 * ```
 */
export class Base44APIMock {
  private handlers: RequestHandler[] = [];

  constructor(readonly appId: string) {}

  // ─── AUTH ENDPOINTS ────────────────────────────────────────

  /** Mock POST /oauth/device/code - Start device authorization flow */
  mockDeviceCode(response: DeviceCodeResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/oauth/device/code`, () =>
        HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock POST /oauth/token - Exchange code for tokens or refresh */
  mockToken(response: TokenResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/oauth/token`, () => HttpResponse.json(response)),
    );
    return this;
  }

  /** Mock GET /oauth/userinfo - Get authenticated user info */
  mockUserInfo(response: UserInfoResponse): this {
    this.handlers.push(
      http.get(`${BASE_URL}/oauth/userinfo`, () => HttpResponse.json(response)),
    );
    return this;
  }

  // ─── APP-SCOPED ENDPOINTS ──────────────────────────────────

  /** Mock PUT /api/apps/{appId}/entity-schemas - Push entities */
  mockEntitiesPush(response: EntitiesPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/entity-schemas`, () =>
        HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock PUT /api/apps/{appId}/backend-functions - Push functions */
  mockFunctionsPush(response: FunctionsPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/backend-functions`, () =>
        HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock POST /api/apps/{appId}/deploy-dist - Deploy site */
  mockSiteDeploy(response: SiteDeployResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/api/apps/${this.appId}/deploy-dist`, () =>
        HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock GET /api/apps/platform/{appId}/published-url - Get site URL */
  mockSiteUrl(response: SiteUrlResponse): this {
    this.handlers.push(
      http.get(
        `${BASE_URL}/api/apps/platform/${this.appId}/published-url`,
        () => HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock PUT /api/apps/{appId}/agent-configs - Push agents */
  mockAgentsPush(response: AgentsPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/agent-configs`, () =>
        HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock GET /api/apps/{appId}/agent-configs - Fetch agents */
  mockAgentsFetch(response: AgentsFetchResponse): this {
    this.handlers.push(
      http.get(`${BASE_URL}/api/apps/${this.appId}/agent-configs`, () =>
        HttpResponse.json(response),
      ),
    );
    return this;
  }

  // ─── CONNECTOR ENDPOINTS ──────────────────────────────────

  /** Mock GET /api/apps/{appId}/external-auth/list - List connectors */
  mockConnectorsList(response: ConnectorsListResponse): this {
    this.handlers.push(
      http.get(`${BASE_URL}/api/apps/${this.appId}/external-auth/list`, () =>
        HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock PUT /api/apps/{appId}/external-auth/integrations/{type} - Set connector */
  mockConnectorSet(response: ConnectorSetResponse): this {
    this.handlers.push(
      http.put(
        `${BASE_URL}/api/apps/${this.appId}/external-auth/integrations/:type`,
        () =>
          HttpResponse.json({
            error: null,
            error_message: null,
            other_user_email: null,
            ...response,
          }),
      ),
    );
    return this;
  }

  /** Mock DELETE /api/apps/{appId}/external-auth/integrations/{type}/remove */
  mockConnectorRemove(response: ConnectorRemoveResponse): this {
    this.handlers.push(
      http.delete(
        `${BASE_URL}/api/apps/${this.appId}/external-auth/integrations/:type/remove`,
        () => HttpResponse.json(response),
      ),
    );
    return this;
  }

  /** Mock GET /api/apps/{appId}/functions-mgmt/{functionName}/logs - Fetch function logs */
  mockFunctionLogs(functionName: string, response: FunctionLogsResponse): this {
    this.handlers.push(
      http.get(
        `${BASE_URL}/api/apps/${this.appId}/functions-mgmt/${functionName}/logs`,
        () => HttpResponse.json(response),
      ),
    );
    return this;
  }

  // ─── GENERAL ENDPOINTS ─────────────────────────────────────

  /** Mock POST /api/apps - Create new app */
  mockCreateApp(response: CreateAppResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/api/apps`, () => HttpResponse.json(response)),
    );
    return this;
  }

  /** Mock GET /api/apps - List projects */
  mockListProjects(response: ListProjectsResponse[]): this {
    this.handlers.push(
      http.get(`${BASE_URL}/api/apps`, () => HttpResponse.json(response)),
    );
    return this;
  }

  /** Mock GET /api/apps/{appId}/eject - Download project as tar */
  mockProjectEject(tarContent: Uint8Array = new Uint8Array()): this {
    this.handlers.push(
      http.get(
        `${BASE_URL}/api/apps/${this.appId}/eject`,
        () =>
          new HttpResponse(tarContent, {
            headers: { "Content-Type": "application/gzip" },
          }),
      ),
    );
    return this;
  }

  // ─── ERROR RESPONSES ────────────────────────────────────────

  /** Mock any endpoint to return an error */
  mockError(
    method: "get" | "post" | "put" | "delete",
    path: string,
    error: ErrorResponse,
  ): this {
    const url = path.startsWith("/")
      ? `${BASE_URL}${path}`
      : `${BASE_URL}/${path}`;
    this.handlers.push(
      http[method](url, () =>
        HttpResponse.json(error.body ?? { error: "Error" }, {
          status: error.status,
        }),
      ),
    );
    return this;
  }

  /** Mock entities push to return an error */
  mockEntitiesPushError(error: ErrorResponse): this {
    return this.mockError(
      "put",
      `/api/apps/${this.appId}/entity-schemas`,
      error,
    );
  }

  /** Mock functions push to return an error */
  mockFunctionsPushError(error: ErrorResponse): this {
    return this.mockError(
      "put",
      `/api/apps/${this.appId}/backend-functions`,
      error,
    );
  }

  /** Mock site deploy to return an error */
  mockSiteDeployError(error: ErrorResponse): this {
    return this.mockError("post", `/api/apps/${this.appId}/deploy-dist`, error);
  }

  /** Mock site URL to return an error */
  mockSiteUrlError(error: ErrorResponse): this {
    return this.mockError(
      "get",
      `/api/apps/platform/${this.appId}/published-url`,
      error,
    );
  }

  /** Mock agents push to return an error */
  mockAgentsPushError(error: ErrorResponse): this {
    return this.mockError(
      "put",
      `/api/apps/${this.appId}/agent-configs`,
      error,
    );
  }

  /** Mock agents fetch to return an error */
  mockAgentsFetchError(error: ErrorResponse): this {
    return this.mockError(
      "get",
      `/api/apps/${this.appId}/agent-configs`,
      error,
    );
  }

  /** Mock function logs to return an error */
  mockFunctionLogsError(functionName: string, error: ErrorResponse): this {
    return this.mockError(
      "get",
      `/api/apps/${this.appId}/functions-mgmt/${functionName}/logs`,
      error,
    );
  }

  /** Mock token endpoint to return an error (for auth failure testing) */

  /** Mock connectors list to return an error */
  mockConnectorsListError(error: ErrorResponse): this {
    return this.mockError(
      "get",
      `/api/apps/${this.appId}/external-auth/list`,
      error,
    );
  }

  /** Mock connector set to return an error */
  mockConnectorSetError(error: ErrorResponse): this {
    return this.mockError(
      "put",
      `/api/apps/${this.appId}/external-auth/integrations/:type`,
      error,
    );
  }

  // ─── INTERNAL ──────────────────────────────────────────────

  /** Apply all registered handlers to MSW (called by CLITestkit.run()) */
  apply(): void {
    if (this.handlers.length > 0) {
      mswServer.use(...this.handlers);
    }
  }
}
