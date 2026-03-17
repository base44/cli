import type { Server } from "node:http";
import { createServer } from "node:http";
import express from "express";
import getPort from "get-port";

// ─── RESPONSE TYPES ──────────────────────────────────────────
// (same as Base44APIMock for interface parity)

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

interface SingleFunctionDeployResponse {
  status: "deployed" | "unchanged";
}

interface AutomationBase {
  name: string;
  description?: string | null;
  function_args?: Record<string, unknown> | null;
  is_active?: boolean;
}

interface ScheduledOneTimeAutomation extends AutomationBase {
  type: "scheduled";
  schedule_mode: "one-time";
  one_time_date: string;
}

interface ScheduledCronAutomation extends AutomationBase {
  type: "scheduled";
  schedule_mode: "recurring";
  schedule_type: "cron";
  cron_expression: string;
  ends_type?: "never" | "on" | "after";
  ends_on_date?: string | null;
  ends_after_count?: number | null;
}

interface ScheduledSimpleAutomation extends AutomationBase {
  type: "scheduled";
  schedule_mode: "recurring";
  schedule_type: "simple";
  repeat_unit: "minutes" | "hours" | "days" | "weeks" | "months";
  repeat_interval?: number;
  start_time?: string | null;
  repeat_on_days?: number[] | null;
  repeat_on_day_of_month?: number | null;
  ends_type?: "never" | "on" | "after";
  ends_on_date?: string | null;
  ends_after_count?: number | null;
}

interface EntityAutomation extends AutomationBase {
  type: "entity";
  entity_name: string;
  event_types: Array<"create" | "update" | "delete">;
}

type AutomationData =
  | ScheduledOneTimeAutomation
  | ScheduledCronAutomation
  | ScheduledSimpleAutomation
  | EntityAutomation;

interface FunctionsListResponse {
  functions: Array<{
    name: string;
    deployment_id: string;
    entry: string;
    files: Array<{ path: string; content: string }>;
    automations: AutomationData[];
  }>;
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

interface StripeInstallResponse {
  already_installed: boolean;
  claim_url: string | null;
}

interface StripeStatusResponse {
  stripe_mode: "sandbox" | "live" | null;
  sandbox_claim_url?: string | null;
}

interface StripeRemoveResponse {
  success: boolean;
}

interface AvailableIntegrationsListResponse {
  integrations: Array<{
    integration_type: string;
    display_name: string;
    description: string;
    connection_config_fields: Array<{
      name: string;
      display_name: string;
      description: string;
      placeholder: string;
      required: boolean;
      validation_pattern?: string | null;
      validation_error?: string | null;
    }>;
  }>;
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

// ─── ROUTE HANDLER TYPES ─────────────────────────────────────

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RouteEntry {
  method: Method;
  /** Express path pattern, e.g. /api/apps/:appId/entity-schemas */
  path: string;
  handler: (req: express.Request, res: express.Response) => void;
}

// ─── SERVER CLASS ────────────────────────────────────────────

/**
 * Lightweight Express HTTP server used in integration tests to simulate the Base44 API.
 *
 * Each test registers expected responses via `mock*` helpers, calls `apply()` to
 * activate the routes, then spawns the CLI binary with `BASE44_API_URL` pointed at
 * this server so all HTTP traffic is intercepted locally.
 *
 * @example
 * ```typescript
 * const server = new TestAPIServer("my-app-id");
 * await server.start();
 *
 * server.mockEntitiesPush({ created: ["User"], updated: [], deleted: [] });
 * server.apply(); // register routes before spawning the binary
 *
 * // binary is spawned with BASE44_API_URL=http://localhost:<port>
 *
 * await server.stop();
 * ```
 */
export class TestAPIServer {
  private pendingRoutes: RouteEntry[] = [];
  private app: express.Application;
  private server: Server | null = null;
  private _port = 0;

  constructor(readonly appId: string) {
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.raw({ type: "*/*", limit: "50mb" }));
  }

  get baseUrl(): string {
    return `http://localhost:${this._port}`;
  }

  // ─── LIFECYCLE ───────────────────────────────────────────

  async start(): Promise<void> {
    this._port = await getPort();
    await new Promise<void>((resolve, reject) => {
      this.server = createServer(this.app);
      this.server.listen(this._port, "127.0.0.1", () => resolve());
      this.server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
    this.pendingRoutes = [];
  }

  /**
   * Register all accumulated mock routes on the Express app.
   * Call this after all mock* methods, before spawning the binary.
   */
  apply(): void {
    for (const entry of this.pendingRoutes) {
      const method = entry.method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "delete";
      this.app[method](entry.path, entry.handler);
    }
    this.pendingRoutes = [];
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────

  private addRoute(
    method: Method,
    path: string,
    body: unknown,
    status = 200,
  ): this {
    this.pendingRoutes.push({
      method,
      path,
      handler: (_req, res) => {
        res.status(status).json(body);
      },
    });
    return this;
  }

  private addErrorRoute(
    method: Method,
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

  // ─── AUTH ENDPOINTS ──────────────────────────────────────

  mockDeviceCode(response: DeviceCodeResponse): this {
    return this.addRoute("POST", "/oauth/device/code", response);
  }

  mockToken(response: TokenResponse): this {
    return this.addRoute("POST", "/oauth/token", response);
  }

  mockUserInfo(response: UserInfoResponse): this {
    return this.addRoute("GET", "/oauth/userinfo", response);
  }

  /** Mock GET /api/apps/{appId}/auth/token - Exchange platform token for app user token */
  mockAuthToken(token: string): this {
    return this.addRoute("GET", `/api/apps/${this.appId}/auth/token`, {
      token,
    });
  }

  // ─── APP-SCOPED ENDPOINTS ────────────────────────────────

  mockEntitiesPush(response: EntitiesPushResponse): this {
    return this.addRoute(
      "PUT",
      `/api/apps/${this.appId}/entity-schemas`,
      response,
    );
  }

  mockFunctionsPush(response: FunctionsPushResponse): this {
    return this.addRoute(
      "PUT",
      `/api/apps/${this.appId}/backend-functions`,
      response,
    );
  }

  mockFunctionsList(response: FunctionsListResponse): this {
    return this.addRoute(
      "GET",
      `/api/apps/${this.appId}/backend-functions`,
      response,
    );
  }

  /** Mock DELETE /api/apps/{appId}/backend-functions/{name} - Delete single function */
  mockSingleFunctionDelete(): this {
    this.pendingRoutes.push({
      method: "DELETE",
      path: `/api/apps/${this.appId}/backend-functions/:name`,
      handler: (_req, res) => {
        res.status(204).end();
      },
    });
    return this;
  }

  /** Mock PUT /api/apps/{appId}/backend-functions/{name} - Deploy single function */
  mockSingleFunctionDeploy(response: SingleFunctionDeployResponse): this {
    return this.addRoute(
      "PUT",
      `/api/apps/${this.appId}/backend-functions/:name`,
      response,
    );
  }

  mockSiteDeploy(response: SiteDeployResponse): this {
    return this.addRoute(
      "POST",
      `/api/apps/${this.appId}/deploy-dist`,
      response,
    );
  }

  mockSiteUrl(response: SiteUrlResponse): this {
    return this.addRoute(
      "GET",
      `/api/apps/platform/${this.appId}/published-url`,
      response,
    );
  }

  mockAgentsPush(response: AgentsPushResponse): this {
    return this.addRoute(
      "PUT",
      `/api/apps/${this.appId}/agent-configs`,
      response,
    );
  }

  mockAgentsFetch(response: AgentsFetchResponse): this {
    return this.addRoute(
      "GET",
      `/api/apps/${this.appId}/agent-configs`,
      response,
    );
  }

  // ─── CONNECTOR ENDPOINTS ─────────────────────────────────

  mockConnectorsList(response: ConnectorsListResponse): this {
    return this.addRoute(
      "GET",
      `/api/apps/${this.appId}/external-auth/list`,
      response,
    );
  }

  mockConnectorSet(response: ConnectorSetResponse): this {
    return this.addRoute(
      "PUT",
      `/api/apps/${this.appId}/external-auth/integrations/:type`,
      {
        error: null,
        error_message: null,
        other_user_email: null,
        ...response,
      },
    );
  }

  mockConnectorRemove(response: ConnectorRemoveResponse): this {
    return this.addRoute(
      "DELETE",
      `/api/apps/${this.appId}/external-auth/integrations/:type/remove`,
      response,
    );
  }

  mockAvailableIntegrationsList(
    response: AvailableIntegrationsListResponse,
  ): this {
    return this.addRoute(
      "GET",
      `/api/apps/${this.appId}/external-auth/available-integrations`,
      response,
    );
  }

  // ─── STRIPE ENDPOINTS ──────────────────────────────────────

  mockStripeInstall(response: StripeInstallResponse): this {
    return this.addRoute(
      "POST",
      `/api/apps/${this.appId}/payments/stripe/install`,
      response,
    );
  }

  mockStripeStatus(response: StripeStatusResponse): this {
    return this.addRoute(
      "GET",
      `/api/apps/${this.appId}/payments/stripe/status`,
      response,
    );
  }

  mockStripeRemove(response: StripeRemoveResponse): this {
    return this.addRoute(
      "DELETE",
      `/api/apps/${this.appId}/payments/stripe`,
      response,
    );
  }

  mockFunctionLogs(functionName: string, response: FunctionLogsResponse): this {
    return this.addRoute(
      "GET",
      `/api/apps/${this.appId}/functions-mgmt/${functionName}/logs`,
      response,
    );
  }

  // ─── SECRETS ENDPOINTS ───────────────────────────────────

  mockSecretsList(response: SecretsListResponse): this {
    return this.addRoute("GET", `/api/apps/${this.appId}/secrets`, response);
  }

  mockSecretsSet(response: SecretsSetResponse): this {
    return this.addRoute("POST", `/api/apps/${this.appId}/secrets`, response);
  }

  mockSecretsDelete(response: SecretsDeleteResponse): this {
    return this.addRoute("DELETE", `/api/apps/${this.appId}/secrets`, response);
  }

  // ─── GENERAL ENDPOINTS ───────────────────────────────────

  mockCreateApp(response: CreateAppResponse): this {
    return this.addRoute("POST", "/api/apps", response);
  }

  mockListProjects(response: ListProjectsResponse[]): this {
    return this.addRoute("GET", "/api/apps", response);
  }

  mockProjectEject(tarContent: Uint8Array = new Uint8Array()): this {
    this.pendingRoutes.push({
      method: "GET",
      path: `/api/apps/${this.appId}/eject`,
      handler: (_req, res) => {
        res.setHeader("Content-Type", "application/gzip");
        res.status(200).send(Buffer.from(tarContent));
      },
    });
    return this;
  }

  /**
   * Register a generic error response for any method/path combination.
   */
  mockError(
    method: "get" | "post" | "put" | "delete",
    path: string,
    error: ErrorResponse,
  ): this {
    return this.addErrorRoute(method.toUpperCase() as Method, path, error);
  }

  /**
   * Register a custom Express handler for advanced scenarios (e.g. stateful
   * responses that change behaviour across retries).
   */
  mockRoute(
    method: Method,
    path: string,
    handler: (req: express.Request, res: express.Response) => void,
  ): this {
    this.pendingRoutes.push({ method, path, handler });
    return this;
  }

  // ─── ERROR RESPONSES ─────────────────────────────────────

  mockEntitiesPushError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "PUT",
      `/api/apps/${this.appId}/entity-schemas`,
      error,
    );
  }

  mockFunctionsListError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "GET",
      `/api/apps/${this.appId}/backend-functions`,
      error,
    );
  }

  /** Mock single function deploy to return an error */
  mockSingleFunctionDeployError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "PUT",
      `/api/apps/${this.appId}/backend-functions/:name`,
      error,
    );
  }

  /** Mock single function delete to return an error */
  mockSingleFunctionDeleteError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "DELETE",
      `/api/apps/${this.appId}/backend-functions/:name`,
      error,
    );
  }

  mockSiteDeployError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "POST",
      `/api/apps/${this.appId}/deploy-dist`,
      error,
    );
  }

  mockSiteUrlError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "GET",
      `/api/apps/platform/${this.appId}/published-url`,
      error,
    );
  }

  mockAgentsPushError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "PUT",
      `/api/apps/${this.appId}/agent-configs`,
      error,
    );
  }

  mockAgentsFetchError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "GET",
      `/api/apps/${this.appId}/agent-configs`,
      error,
    );
  }

  mockFunctionLogsError(functionName: string, error: ErrorResponse): this {
    return this.addErrorRoute(
      "GET",
      `/api/apps/${this.appId}/functions-mgmt/${functionName}/logs`,
      error,
    );
  }

  mockSecretsListError(error: ErrorResponse): this {
    return this.addErrorRoute("GET", `/api/apps/${this.appId}/secrets`, error);
  }

  mockSecretsSetError(error: ErrorResponse): this {
    return this.addErrorRoute("POST", `/api/apps/${this.appId}/secrets`, error);
  }

  mockSecretsDeleteError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "DELETE",
      `/api/apps/${this.appId}/secrets`,
      error,
    );
  }

  mockConnectorsListError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "GET",
      `/api/apps/${this.appId}/external-auth/list`,
      error,
    );
  }

  mockConnectorSetError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "PUT",
      `/api/apps/${this.appId}/external-auth/integrations/:type`,
      error,
    );
  }

  mockStripeInstallError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "POST",
      `/api/apps/${this.appId}/payments/stripe/install`,
      error,
    );
  }

  mockAvailableIntegrationsListError(error: ErrorResponse): this {
    return this.addErrorRoute(
      "GET",
      `/api/apps/${this.appId}/external-auth/available-integrations`,
      error,
    );
  }
}
