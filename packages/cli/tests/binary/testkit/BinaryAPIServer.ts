import { createServer } from "node:http";
import type { Server } from "node:http";
import express from "express";
import type { Application, Request, Response } from "express";
import getPort from "get-port";

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
  level: "info" | "warning" | "error" | "debug";
  message: string;
}

type FunctionLogsResponse = FunctionLogEntry[];

type SecretsListResponse = Record<string, string>;

interface SecretsSetResponse {
  success: boolean;
}

interface SecretsDeleteResponse {
  success: boolean;
}

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

// ─── SERVER CLASS ──────────────────────────────────────────────

/**
 * Real HTTP server that serves mocked Base44 API responses.
 * Used by BinaryTestkit to test the actual CLI binary end-to-end.
 *
 * Each mock method registers an Express route on the server.
 * Since a fresh BinaryAPIServer is created per test, route isolation
 * is automatic — no reset needed.
 *
 * @example
 * ```typescript
 * const server = new BinaryAPIServer("my-app-id");
 * await server.start();
 * server.mockEntitiesPush({ created: ["User"], updated: [], deleted: [] });
 * // ... run binary with BASE44_API_URL=server.baseUrl ...
 * await server.stop();
 * ```
 */
export class BinaryAPIServer {
  private app: Application;
  private server: Server | null = null;
  private _port = 0;

  constructor(readonly appId: string) {
    this.app = express();
    this.app.use(express.json());
  }

  get baseUrl(): string {
    return `http://localhost:${this._port}`;
  }

  async start(): Promise<void> {
    this._port = await getPort();
    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(this._port, () => resolve());
      this.server!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }

  private addRoute(
    method: "get" | "post" | "put" | "delete",
    path: string,
    body: unknown,
    status = 200,
  ): this {
    this.app[method](path, (_req: Request, res: Response) => {
      res.status(status).json(body);
    });
    return this;
  }

  // ─── AUTH ENDPOINTS ────────────────────────────────────────

  /** Mock POST /oauth/device/code */
  mockDeviceCode(response: DeviceCodeResponse): this {
    return this.addRoute("post", "/oauth/device/code", response);
  }

  /** Mock POST /oauth/token */
  mockToken(response: TokenResponse): this {
    return this.addRoute("post", "/oauth/token", response);
  }

  /** Mock GET /oauth/userinfo */
  mockUserInfo(response: UserInfoResponse): this {
    return this.addRoute("get", "/oauth/userinfo", response);
  }

  // ─── APP-SCOPED ENDPOINTS ──────────────────────────────────

  /** Mock PUT /api/apps/{appId}/entity-schemas */
  mockEntitiesPush(response: EntitiesPushResponse): this {
    return this.addRoute(
      "put",
      `/api/apps/${this.appId}/entity-schemas`,
      response,
    );
  }

  /** Mock PUT /api/apps/{appId}/backend-functions */
  mockFunctionsPush(response: FunctionsPushResponse): this {
    return this.addRoute(
      "put",
      `/api/apps/${this.appId}/backend-functions`,
      response,
    );
  }

  /** Mock POST /api/apps/{appId}/deploy-dist */
  mockSiteDeploy(response: SiteDeployResponse): this {
    return this.addRoute(
      "post",
      `/api/apps/${this.appId}/deploy-dist`,
      response,
    );
  }

  /** Mock GET /api/apps/platform/{appId}/published-url */
  mockSiteUrl(response: SiteUrlResponse): this {
    return this.addRoute(
      "get",
      `/api/apps/platform/${this.appId}/published-url`,
      response,
    );
  }

  /** Mock PUT /api/apps/{appId}/agent-configs */
  mockAgentsPush(response: AgentsPushResponse): this {
    return this.addRoute(
      "put",
      `/api/apps/${this.appId}/agent-configs`,
      response,
    );
  }

  /** Mock GET /api/apps/{appId}/agent-configs */
  mockAgentsFetch(response: AgentsFetchResponse): this {
    return this.addRoute(
      "get",
      `/api/apps/${this.appId}/agent-configs`,
      response,
    );
  }

  // ─── CONNECTOR ENDPOINTS ──────────────────────────────────

  /** Mock GET /api/apps/{appId}/external-auth/list */
  mockConnectorsList(response: ConnectorsListResponse): this {
    return this.addRoute(
      "get",
      `/api/apps/${this.appId}/external-auth/list`,
      response,
    );
  }

  /** Mock PUT /api/apps/{appId}/external-auth/integrations/:type */
  mockConnectorSet(response: ConnectorSetResponse): this {
    return this.addRoute(
      "put",
      `/api/apps/${this.appId}/external-auth/integrations/:type`,
      { error: null, error_message: null, other_user_email: null, ...response },
    );
  }

  /** Mock DELETE /api/apps/{appId}/external-auth/integrations/:type/remove */
  mockConnectorRemove(response: ConnectorRemoveResponse): this {
    return this.addRoute(
      "delete",
      `/api/apps/${this.appId}/external-auth/integrations/:type/remove`,
      response,
    );
  }

  // ─── SECRETS ENDPOINTS ──────────────────────────────────────

  /** Mock GET /api/apps/{appId}/secrets */
  mockSecretsList(response: SecretsListResponse): this {
    return this.addRoute("get", `/api/apps/${this.appId}/secrets`, response);
  }

  /** Mock POST /api/apps/{appId}/secrets */
  mockSecretsSet(response: SecretsSetResponse): this {
    return this.addRoute("post", `/api/apps/${this.appId}/secrets`, response);
  }

  /** Mock DELETE /api/apps/{appId}/secrets */
  mockSecretsDelete(response: SecretsDeleteResponse): this {
    return this.addRoute(
      "delete",
      `/api/apps/${this.appId}/secrets`,
      response,
    );
  }

  // ─── LOGS ENDPOINTS ─────────────────────────────────────────

  /** Mock GET /api/apps/{appId}/functions-mgmt/{functionName}/logs */
  mockFunctionLogs(functionName: string, response: FunctionLogsResponse): this {
    return this.addRoute(
      "get",
      `/api/apps/${this.appId}/functions-mgmt/${functionName}/logs`,
      response,
    );
  }

  // ─── GENERAL ENDPOINTS ─────────────────────────────────────

  /** Mock POST /api/apps */
  mockCreateApp(response: CreateAppResponse): this {
    return this.addRoute("post", "/api/apps", response);
  }

  /** Mock GET /api/apps */
  mockListProjects(response: ListProjectsResponse[]): this {
    return this.addRoute("get", "/api/apps", response);
  }

  // ─── ERROR HELPERS ──────────────────────────────────────────

  /** Mock any endpoint to return an error */
  mockError(
    method: "get" | "post" | "put" | "delete",
    path: string,
    error: ErrorResponse,
  ): this {
    return this.addRoute(
      method,
      path,
      error.body ?? { error: "Error" },
      error.status,
    );
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
    return this.mockError(
      "post",
      `/api/apps/${this.appId}/deploy-dist`,
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

  /** Mock connectors list to return an error */
  mockConnectorsListError(error: ErrorResponse): this {
    return this.mockError(
      "get",
      `/api/apps/${this.appId}/external-auth/list`,
      error,
    );
  }
}
