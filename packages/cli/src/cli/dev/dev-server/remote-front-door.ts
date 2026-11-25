import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import cors from "cors";
import express from "express";
import getPort from "get-port";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import {
  type AppServerTarget,
  createAppServerProxy,
} from "@/cli/dev/dev-server/routes/app-server.js";
import {
  createLoginGate,
  type LoginGateOptions,
} from "@/cli/dev/dev-server/routes/login-gate.js";
import { theme } from "@/cli/utils/index.js";
import { PLATFORM_PATH_PATTERN } from "./platform-paths.js";
import { REALTIME_PATH } from "./realtime.js";

const DEFAULT_PORT = 4400;

interface RemoteFrontDoorOptions {
  port?: number;
  /** The live app, which answers the platform's paths. */
  siteUrl: string;
  appServer: AppServerTarget;
  loginGate?: LoginGateOptions;
}

interface RemoteFrontDoor {
  port: number;
}

/**
 * `base44 dev --remote`: the same single origin as the local front door, with
 * the platform's paths answered by the live app instead of a local backend.
 */
export async function createRemoteFrontDoor(
  options: RemoteFrontDoorOptions,
): Promise<RemoteFrontDoor> {
  const port =
    options.port ??
    (await getPort({
      port: process.env.IS_TEST === "true" ? undefined : DEFAULT_PORT,
    }));
  const logger = createDevLogger("front door", theme.styles.info);
  const app = express();

  app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/, credentials: true }));
  if (options.loginGate) {
    app.use(createLoginGate(options.loginGate, logger));
  }

  const liveApp = createProxyMiddleware<IncomingMessage, ServerResponse>({
    target: options.siteUrl,
    changeOrigin: true,
  });
  const appServerProxy = createAppServerProxy(
    { ...options.appServer, serviceRole: false },
    logger,
  );

  app.use((req, res, next) =>
    PLATFORM_PATH_PATTERN.test(req.path)
      ? liveApp(req, res, next)
      : appServerProxy.middleware(req, res, next),
  );

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", (err) =>
      err ? reject(err) : resolve(s),
    );
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith(REALTIME_PATH)) {
      liveApp.upgrade(req, socket as Socket, head);
    } else {
      appServerProxy.upgrade(req, socket, head);
    }
  });

  return { port };
}
