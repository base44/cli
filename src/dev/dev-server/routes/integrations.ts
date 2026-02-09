import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import type { Logger } from "@/dev/createDevLogger";

/**
 * Creates routes for Core and installable package integrations.
 * Mounted at: /api/apps/:appId/integration-endpoints
 */
export function createIntegrationRoutes(
  mediaFilesDir: string,
  baseUrl: string,
  logger: Logger
): Router {
  const router = Router({ mergeParams: true });

  // Ensure files directory exists
  fs.mkdirSync(mediaFilesDir, { recursive: true });

  // Configure multer storage for file uploads
  const storage = multer.diskStorage({
    destination: mediaFilesDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  });
  const upload = multer({ storage });

  router.post(
    "/Core/UploadFile",
    upload.single("file"),
    (req: Request, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const file_url = `${baseUrl}/media/${req.file.filename}`;
      logger.log(`Core.UploadFile -> ${file_url}`);
      res.json({ file_url });
    }
  );

  router.post(
    "/Core/UploadPrivateFile",
    upload.single("file"),
    (req: Request, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const file_uri = req.file.filename;
      logger.log(`Core.UploadPrivateFile -> ${file_uri}`);
      res.json({ file_uri });
    }
  );

  router.post("/Core/CreateFileSignedUrl", (req: Request, res: Response) => {
    const { file_uri } = req.body;
    if (!file_uri) {
      res.status(400).json({ error: "file_uri is required" });
      return;
    }
    const signature = randomUUID();
    const signed_url = `${baseUrl}/media/${file_uri}?signature=${signature}`;
    logger.log(`Core.CreateFileSignedUrl -> ${signed_url}`);
    res.json({ signed_url });
  });

  // Other Core endpoints (stub for future implementation)
  router.post(
    "/Core/:endpointName",
    (req: Request<{ endpointName: string }>, res: Response) => {
      logger.warn(
        `Core.${req.params.endpointName} is not supported in local development`
      );
      res.json({});
    }
  );

  // Installable package integrations (stub)
  router.post(
    "/installable/:packageName/integration-endpoints/:endpointName",
    (
      req: Request<{ packageName: string; endpointName: string }>,
      res: Response
    ) => {
      logger.warn(
        `${req.params.packageName}.${req.params.endpointName} is not supported in local development`
      );
      res.json({});
    }
  );

  return router;
}

export function createCustomIntegrationRoutes(logger: Logger): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/:slug/:operationId",
    (req: Request<{ slug: string; operationId: string }>, res: Response) => {
      logger.warn(
        `custom.call(${req.params.slug}, ${req.params.operationId}) is not supported in local development`
      );
      res.json({ success: true, data: {} });
    }
  );

  return router;
}
