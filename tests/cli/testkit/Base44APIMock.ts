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
  created: string[];
  updated: string[];
  deleted: string[];
}

export interface SiteDeployResponse {
  appUrl: string;
}

export interface CreateAppResponse {
  id: string;
  name: string;
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

  // ─── INTERNAL ──────────────────────────────────────────────

  /** Apply all registered handlers to MSW (called by CLITestkit.run()) */
  apply(): void {
    if (this.handlers.length > 0) {
      mswServer.use(...this.handlers);
    }
  }
}
