import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { json, Router } from "express";
import multer from "multer";
import type { Logger } from "../../createDevLogger.js";

export function createFileToken(fileUri: string): string {
  return createHash("sha256").update(fileUri).digest("hex");
}

/**
 * Creates routes for Core and installable package integrations.
 * Mounted at: /api/apps/:appId/integration-endpoints
 */
export function createIntegrationRoutes(
  mediaFilesDir: string,
  baseUrl: string,
  remoteProxy: RequestHandler,
  logger: Logger,
): Router {
  const router = Router({ mergeParams: true });
  const parseBody = json();

  const privateFilesDir = path.join(mediaFilesDir, "private");
  fs.mkdirSync(mediaFilesDir, { recursive: true });
  fs.mkdirSync(privateFilesDir, { recursive: true });

  // File size limitation is 50 MB
  // https://docs.base44.com/Building-your-app/Using-media#sharing-media-on-your-live-app
  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const storage = multer.diskStorage({
    destination: mediaFilesDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  const privateStorage = multer.diskStorage({
    destination: privateFilesDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });
  const privateUpload = multer({
    storage: privateStorage,
    limits: { fileSize: MAX_FILE_SIZE },
  });

  router.post(
    "/Core/UploadFile",
    upload.single("file"),
    (req: Request, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const file_url = `${baseUrl}/media/${req.file.filename}`;
      res.json({ file_url });
    },
  );

  router.post(
    "/Core/UploadPrivateFile",
    privateUpload.single("file"),
    (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const file_uri = req.file.filename;
      res.json({ file_uri });
    },
  );

  router.post("/Core/CreateFileSignedUrl", parseBody, (req, res) => {
    const { file_uri } = req.body;
    if (!file_uri) {
      res.status(400).json({ error: "file_uri is required" });
      return;
    }
    const token = createFileToken(file_uri);
    const signed_url = `${baseUrl}/media/private/${file_uri}?token=${token}`;
    res.json({ signed_url });
  });

  router.post(
    "/Core/:endpointName",
    (req: Request<{ endpointName: string }>, res, next) => {
      logger.warn(
        `Core.${req.params.endpointName} is not supported in local development`,
      );
      // This is necessary because Express strips the router prefix from req.url,
      // so without this the proxy would send just `/Core/:endpointName` instead of the full path.
      req.url = req.originalUrl;
      remoteProxy(req, res, next);
    },
  );

  router.post(
    "/installable/:packageName/integration-endpoints/:endpointName",
    (
      req: Request<{ packageName: string; endpointName: string }>,
      res,
      next,
    ) => {
      logger.warn(
        `${req.params.packageName}.${req.params.endpointName} is not supported in local development`,
      );
      // This is necessary because Express strips the router prefix from req.url,
      // so without this the proxy would send just `/installable/:packageName/integration-endpoints/:endpointName` instead of the full path.
      req.url = req.originalUrl;
      remoteProxy(req, res, next);
    },
  );

  router.use(
    (err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (err instanceof multer.MulterError) {
        res
          .status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400)
          .json({ error: err.message });
        return;
      }
      next(err);
    },
  );

  return router;
}

export function createCustomIntegrationRoutes(
  remoteProxy: RequestHandler,
  logger: Logger,
): Router {
  const router = Router({ mergeParams: true });

  router.post("/:slug/:operationId", (req, res, next) => {
    logger.warn(
      `"${req.originalUrl}" is not supported in local development, passing call to production`,
    );
    // This is necessary because Express strips the router prefix from req.url,
    // so without this the proxy would send just `/:slug/:operationId` instead of the full path.
    req.url = req.originalUrl;
    remoteProxy(req, res, next);
  });

  return router;
}
