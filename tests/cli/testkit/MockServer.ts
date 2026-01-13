import polka, { type Polka } from "polka";
import { createServer, type Server, type RequestListener } from "http";

export type RouteHandler = (params: Record<string, string>) => {
  status?: number;
  body: unknown;
};

/**
 * Singleton mock HTTP server for CLI tests using polka.
 * Supports route parameters like /api/apps/:appId/entities
 */
class MockServer {
  private app: Polka | null = null;
  private server: Server | null = null;
  private port: number | null = null;

  async start(): Promise<void> {
    if (this.server) return;

    this.app = polka();
    this.server = createServer(this.app.handler as RequestListener);

    await new Promise<void>((resolve) => {
      this.server!.listen(0, () => {
        const address = this.server!.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    this.app = null;
    this.port = null;
  }

  getUrl(): string {
    if (!this.port) throw new Error("MockServer not started");
    return `http://localhost:${this.port}`;
  }

  /** Register a route handler with :param support */
  addRoute(method: string, path: string, handler: RouteHandler): void {
    if (!this.app) throw new Error("MockServer not started");

    const m = method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";

    this.app[m](path, (req, res) => {
      try {
        const params = req.params as Record<string, string>;
        const result = handler(params);
        res.writeHead(result.status ?? 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  }

  /** Clear all routes by recreating the app */
  resetRoutes(): void {
    if (!this.server) return;
    this.app = polka();
    this.server.removeAllListeners("request");
    this.server.on("request", this.app.handler as RequestListener);
  }
}

export const mockServer = new MockServer();
