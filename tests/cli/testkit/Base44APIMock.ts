import type { RequestHandler } from "msw";
import { http, HttpResponse } from "msw";
import { mswServer } from "./index.js";

const BASE_URL = "https://app.base44.com";

// ─── RESPONSE TYPES ──────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface UserInfoResponse {
  email: string;
  name?: string;
}

export interface EntitiesPushResponse {
  created: string[];
  updated: string[];
  deleted: string[];
}

export interface FunctionsPushResponse {
  deployed: string[];
  deleted: string[];
  errors: Array<{ name: string; message: string }> | null;
}

export interface SiteDeployResponse {
  app_url: string;
}

export interface SiteUrlResponse {
  url: string;
}

export interface AgentsPushResponse {
  created: string[];
  updated: string[];
  deleted: string[];
}

export interface AgentsFetchResponse {
  items: Array<{ name: string; [key: string]: unknown }>;
  total: number;
}

export interface CreateAppResponse {
  id: string;
  name: string;
}

export interface ErrorResponse {
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
      http.post(`${BASE_URL}/oauth/device/code`, () => HttpResponse.json(response))
    );
    return this;
  }

  /** Mock POST /oauth/token - Exchange code for tokens or refresh */
  mockToken(response: TokenResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/oauth/token`, () => HttpResponse.json(response))
    );
    return this;
  }

  /** Mock GET /oauth/userinfo - Get authenticated user info */
  mockUserInfo(response: UserInfoResponse): this {
    this.handlers.push(
      http.get(`${BASE_URL}/oauth/userinfo`, () => HttpResponse.json(response))
    );
    return this;
  }

  // ─── APP-SCOPED ENDPOINTS ──────────────────────────────────

  /** Mock PUT /api/apps/{appId}/entity-schemas - Push entities */
  mockEntitiesPush(response: EntitiesPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/entity-schemas`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  /** Mock PUT /api/apps/{appId}/backend-functions - Push functions */
  mockFunctionsPush(response: FunctionsPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/backend-functions`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  /** Mock POST /api/apps/{appId}/deploy-dist - Deploy site */
  mockSiteDeploy(response: SiteDeployResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/api/apps/${this.appId}/deploy-dist`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  /** Mock GET /api/apps/platform/{appId}/published-url - Get site URL */
  mockSiteUrl(response: SiteUrlResponse): this {
    this.handlers.push(
      http.get(`${BASE_URL}/api/apps/platform/${this.appId}/published-url`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  /** Mock PUT /api/apps/{appId}/agent-configs - Push agents */
  mockAgentsPush(response: AgentsPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/agent-configs`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  /** Mock GET /api/apps/{appId}/agent-configs - Fetch agents */
  mockAgentsFetch(response: AgentsFetchResponse): this {
    this.handlers.push(
      http.get(`${BASE_URL}/api/apps/${this.appId}/agent-configs`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  // ─── GENERAL ENDPOINTS ─────────────────────────────────────

  /** Mock POST /api/apps - Create new app */
  mockCreateApp(response: CreateAppResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/api/apps`, () => HttpResponse.json(response))
    );
    return this;
  }

  // ─── ERROR RESPONSES ────────────────────────────────────────

  /** Mock any endpoint to return an error */
  mockError(method: "get" | "post" | "put" | "delete", path: string, error: ErrorResponse): this {
    const url = path.startsWith("/") ? `${BASE_URL}${path}` : `${BASE_URL}/${path}`;
    this.handlers.push(
      http[method](url, () => HttpResponse.json(error.body ?? { error: "Error" }, { status: error.status }))
    );
    return this;
  }

  /** Mock entities push to return an error */
  mockEntitiesPushError(error: ErrorResponse): this {
    return this.mockError("put", `/api/apps/${this.appId}/entity-schemas`, error);
  }

  /** Mock functions push to return an error */
  mockFunctionsPushError(error: ErrorResponse): this {
    return this.mockError("put", `/api/apps/${this.appId}/backend-functions`, error);
  }

  /** Mock site deploy to return an error */
  mockSiteDeployError(error: ErrorResponse): this {
    return this.mockError("post", `/api/apps/${this.appId}/deploy-dist`, error);
  }

  /** Mock site URL to return an error */
  mockSiteUrlError(error: ErrorResponse): this {
    return this.mockError("get", `/api/apps/platform/${this.appId}/published-url`, error);
  }

  /** Mock agents push to return an error */
  mockAgentsPushError(error: ErrorResponse): this {
    return this.mockError("put", `/api/apps/${this.appId}/agent-configs`, error);
  }

  /** Mock agents fetch to return an error */
  mockAgentsFetchError(error: ErrorResponse): this {
    return this.mockError("get", `/api/apps/${this.appId}/agent-configs`, error);
  }

  /** Mock token endpoint to return an error (for auth failure testing) */
  mockTokenError(error: ErrorResponse): this {
    return this.mockError("post", "/oauth/token", error);
  }

  /** Mock userinfo endpoint to return an error */
  mockUserInfoError(error: ErrorResponse): this {
    return this.mockError("get", "/oauth/userinfo", error);
  }

  // ─── INTERNAL ──────────────────────────────────────────────

  /** Apply all registered handlers to MSW (called by CLITestkit.run()) */
  apply(): void {
    if (this.handlers.length > 0) {
      mswServer.use(...this.handlers);
    }
  }
}
