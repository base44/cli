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

export interface CreateAppResponse {
  id: string;
  name: string;
}

export interface ErrorResponse {
  status: number;
  body?: unknown;
}

// ─── MOCK CLASS ──────────────────────────────────────────────

export class Base44APIMock {
  private handlers: RequestHandler[] = [];

  constructor(readonly appId: string) {}

  // ─── AUTH ENDPOINTS ────────────────────────────────────────

  /** Mock POST /oauth/device/code - Start device authorization flow */
  setDeviceCodeResponse(response: DeviceCodeResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/oauth/device/code`, () => HttpResponse.json(response))
    );
    return this;
  }

  /** Mock POST /oauth/token - Exchange code for tokens or refresh */
  setTokenResponse(response: TokenResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/oauth/token`, () => HttpResponse.json(response))
    );
    return this;
  }

  /** Mock GET /oauth/userinfo - Get authenticated user info */
  setUserInfoResponse(response: UserInfoResponse): this {
    this.handlers.push(
      http.get(`${BASE_URL}/oauth/userinfo`, () => HttpResponse.json(response))
    );
    return this;
  }

  // ─── APP-SCOPED ENDPOINTS ──────────────────────────────────

  /** Mock PUT /api/apps/{appId}/entity-schemas - Push entities */
  setEntitiesPushResponse(response: EntitiesPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/entity-schemas`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  /** Mock PUT /api/apps/{appId}/backend-functions - Push functions */
  setFunctionsPushResponse(response: FunctionsPushResponse): this {
    this.handlers.push(
      http.put(`${BASE_URL}/api/apps/${this.appId}/backend-functions`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  /** Mock POST /api/apps/{appId}/deploy-dist - Deploy site */
  setSiteDeployResponse(response: SiteDeployResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/api/apps/${this.appId}/deploy-dist`, () =>
        HttpResponse.json(response)
      )
    );
    return this;
  }

  // ─── GENERAL ENDPOINTS ─────────────────────────────────────

  /** Mock POST /api/apps - Create new app */
  setCreateAppResponse(response: CreateAppResponse): this {
    this.handlers.push(
      http.post(`${BASE_URL}/api/apps`, () => HttpResponse.json(response))
    );
    return this;
  }

  // ─── ERROR RESPONSES ────────────────────────────────────────

  /** Mock any endpoint to return an error */
  setErrorResponse(method: "get" | "post" | "put" | "delete", path: string, error: ErrorResponse): this {
    const url = path.startsWith("/") ? `${BASE_URL}${path}` : `${BASE_URL}/${path}`;
    this.handlers.push(
      http[method](url, () => HttpResponse.json(error.body ?? { error: "Error" }, { status: error.status }))
    );
    return this;
  }

  /** Mock entities push to return an error */
  setEntitiesPushError(error: ErrorResponse): this {
    return this.setErrorResponse("put", `/api/apps/${this.appId}/entity-schemas`, error);
  }

  /** Mock functions push to return an error */
  setFunctionsPushError(error: ErrorResponse): this {
    return this.setErrorResponse("put", `/api/apps/${this.appId}/backend-functions`, error);
  }

  /** Mock site deploy to return an error */
  setSiteDeployError(error: ErrorResponse): this {
    return this.setErrorResponse("post", `/api/apps/${this.appId}/deploy-dist`, error);
  }

  /** Mock token endpoint to return an error (for auth failure testing) */
  setTokenError(error: ErrorResponse): this {
    return this.setErrorResponse("post", "/oauth/token", error);
  }

  /** Mock userinfo endpoint to return an error */
  setUserInfoError(error: ErrorResponse): this {
    return this.setErrorResponse("get", "/oauth/userinfo", error);
  }

  // ─── INTERNAL ──────────────────────────────────────────────

  /** Apply all registered handlers to MSW (called by CLITestkit.run()) */
  apply(): void {
    if (this.handlers.length > 0) {
      mswServer.use(...this.handlers);
    }
  }
}
