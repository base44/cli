import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { nanoid } from "nanoid";
import type { Logger } from "@/dev/createDevLogger.js";
import type { Database } from "../database.js";

interface EntityParams {
  entityName: string;
  id?: string;
}

/**
 * Parse sort string into NeDB sort object.
 * "-field" → { field: -1 } (descending)
 * "field" → { field: 1 } (ascending)
 */
function parseSort(
  sort: string | undefined
): Record<string, 1 | -1> | undefined {
  if (!sort) {
    return undefined;
  }

  if (sort.startsWith("-")) {
    return { [sort.slice(1)]: -1 };
  }
  return { [sort]: 1 };
}

/**
 * Parse fields string into NeDB projection object.
 * "a,b,c" → { a: 1, b: 1, c: 1 }
 */
function parseFields(
  fields: string | undefined
): Record<string, 1> | undefined {
  if (!fields) {
    return undefined;
  }

  const projection: Record<string, 1> = {};
  for (const field of fields.split(",")) {
    const trimmed = field.trim();
    if (trimmed) {
      projection[trimmed] = 1;
    }
  }
  return Object.keys(projection).length > 0 ? projection : undefined;
}

/**
 * Create entity routes for the dev server.
 */
export function createEntityRoutes(db: Database, logger: Logger): Router {
  const router = createRouter({ mergeParams: true });

  // GET /entities/User/me - Return empty object for current user
  router.get("/User/:anyName", (_req, res) => {
    res.json({});
  });

  // GET /entities/:entityName/:id - Get by ID
  router.get(
    "/:entityName/:id",
    async (req: Request<EntityParams>, res: Response) => {
      const { entityName, id } = req.params;
      const collection = db.getCollection(entityName);

      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }

      try {
        const doc = await collection.findOneAsync({ id });
        if (!doc) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }
        res.json(doc);
      } catch (error) {
        logger.error(`Error in GET /${entityName}/${id}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // GET /entities/:entityName - List or Filter
  router.get(
    "/:entityName",
    async (req: Request<EntityParams>, res: Response) => {
      const { entityName } = req.params;
      const collection = db.getCollection(entityName);

      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }

      try {
        const { sort, limit, skip, fields, q } = req.query;

        // Parse query from q parameter
        let query = {};
        if (q && typeof q === "string") {
          try {
            query = JSON.parse(q);
          } catch {
            res.status(400).json({ error: "Invalid query parameter 'q'" });
            return;
          }
        }

        // Build cursor
        let cursor = collection.findAsync(query);

        const sortObj = parseSort(sort as string | undefined);
        if (sortObj) {
          cursor = cursor.sort(sortObj);
        }

        if (skip) {
          const skipNum = parseInt(skip as string, 10);
          if (!Number.isNaN(skipNum)) {
            cursor = cursor.skip(skipNum);
          }
        }

        if (limit) {
          const limitNum = parseInt(limit as string, 10);
          if (!Number.isNaN(limitNum)) {
            cursor = cursor.limit(limitNum);
          }
        }

        const projection = parseFields(fields as string | undefined);
        if (projection) {
          cursor = cursor.projection(projection);
        }

        const docs = await cursor;
        res.json(docs);
      } catch (error) {
        logger.error(`Error in GET /${entityName}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /entities/:entityName - Create
  router.post(
    "/:entityName",
    async (req: Request<EntityParams>, res: Response) => {
      const { entityName } = req.params;
      const collection = db.getCollection(entityName);

      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }

      try {
        const now = new Date().toISOString();
        const record = {
          ...req.body,
          id: nanoid(),
          created_date: now,
          updated_date: now,
        };

        const inserted = await collection.insertAsync(record);
        res.status(201).json(inserted);
      } catch (error) {
        logger.error(`Error in POST /${entityName}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /entities/:entityName/bulk - Bulk Create
  router.post(
    "/:entityName/bulk",
    async (req: Request<EntityParams>, res: Response) => {
      const { entityName } = req.params;
      const collection = db.getCollection(entityName);

      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }

      if (!Array.isArray(req.body)) {
        res.status(400).json({ error: "Request body must be an array" });
        return;
      }

      try {
        const now = new Date().toISOString();
        const records = req.body.map((item: Record<string, unknown>) => ({
          ...item,
          id: nanoid(),
          created_date: now,
          updated_date: now,
        }));

        const inserted: Record<string, unknown>[] = [];
        for (const record of records) {
          const doc = await collection.insertAsync(record);
          inserted.push(doc);
        }

        res.status(201).json(inserted);
      } catch (error) {
        logger.error(`Error in POST /${entityName}/bulk:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // PUT /entities/:entityName/:id - Update
  router.put(
    "/:entityName/:id",
    async (req: Request<EntityParams>, res: Response) => {
      const { entityName, id } = req.params;
      const collection = db.getCollection(entityName);

      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }

      try {
        const updateData = {
          ...req.body,
          updated_date: new Date().toISOString(),
        };

        const result = await collection.updateAsync(
          { id },
          { $set: updateData },
          { returnUpdatedDocs: false }
        );

        if (result.numAffected === 0) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }

        // Fetch the updated document
        const updated = await collection.findOneAsync({ id });
        res.json(updated);
      } catch (error) {
        logger.error(`Error in PUT /${entityName}/${id}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.delete(
    "/:entityName/:id",
    async (req: Request<EntityParams>, res: Response) => {
      const { entityName, id } = req.params;
      const collection = db.getCollection(entityName);

      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }

      try {
        const numRemoved = await collection.removeAsync(
          { id },
          { multi: false }
        );

        if (numRemoved === 0) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }

        res.json({ deleted: numRemoved });
      } catch (error) {
        logger.error(`Error in DELETE /${entityName}/${id}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.delete(
    "/:entityName",
    async (req: Request<EntityParams>, res: Response) => {
      const { entityName } = req.params;
      const collection = db.getCollection(entityName);

      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }

      try {
        const query = req.body || {};
        const numRemoved = await collection.removeAsync(query, { multi: true });
        res.json({ deleted: numRemoved });
      } catch (error) {
        logger.error(`Error in DELETE /${entityName}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Default route - return empty object for unmatched paths
  router.use((_req, res) => {
    res.json({});
  });

  return router;
}
