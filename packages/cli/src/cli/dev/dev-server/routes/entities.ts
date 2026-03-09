import type Datastore from "@seald-io/nedb";
import type { Request, RequestHandler, Response, Router } from "express";
import { Router as createRouter, json } from "express";
import { nanoid } from "nanoid";
import type { Logger } from "../../createDevLogger.js";
import type { Database } from "../db/database.js";
import type { BroadcastEntityEvent, EntityEventType } from "../realtime.js";

interface EntityParams {
  appId: string;
  entityName: string;
  id?: string;
}

/**
 * Parse sort string into NeDB sort object.
 * "-field" → { field: -1 } (descending)
 * "field" → { field: 1 } (ascending)
 */
function parseSort(
  sort: string | undefined,
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
  fields: string | undefined,
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

function stripInternalFields<T extends Record<string, unknown>>(
  doc: T[],
): Omit<T, "_id">[];
function stripInternalFields<T extends Record<string, unknown>>(
  doc: T,
): Omit<T, "_id">;
function stripInternalFields<T extends Record<string, unknown>>(
  doc: T | T[],
): Omit<T, "_id"> | Omit<T, "_id">[] {
  if (Array.isArray(doc)) {
    return doc.map((d) => stripInternalFields(d));
  }
  const { _id, ...rest } = doc;
  return rest;
}

export function createEntityRoutes(
  db: Database,
  logger: Logger,
  remoteProxy: RequestHandler,
  broadcast: BroadcastEntityEvent,
): Router {
  const router = createRouter({ mergeParams: true });
  const parseBody = json();

  function withCollection(
    handler: (
      req: Request<EntityParams>,
      res: Response,
      collection: Datastore,
    ) => Promise<void> | void,
  ): (req: Request<EntityParams>, res: Response) => Promise<void> {
    return async (req, res) => {
      const collection = db.getCollection(req.params.entityName);
      if (!collection) {
        res
          .status(404)
          .json({ error: `Entity "${req.params.entityName}" not found` });
        return;
      }
      await handler(req, res, collection);
    };
  }

  function emit(
    appId: string,
    entityName: string,
    type: EntityEventType,
    data: Record<string, unknown> | Record<string, unknown>[],
  ) {
    const createData = (item: Record<string, unknown>) => ({
      type,
      data: item,
      id: item.id as string,
      timestamp: new Date().toISOString(),
    });
    if (Array.isArray(data)) {
      for (const item of data) {
        broadcast(appId, entityName, createData(item));
      }
      return;
    }
    broadcast(appId, entityName, createData(data));
  }

  router.get("/User/:id", (req, res, next) => {
    logger.warn(
      `"${req.originalUrl}" is not supported in local development, passing call to production`,
    );
    // This is necessary because Express strips the router prefix from req.url,
    // so without this the proxy would send just `/User/:id` instead of the full path.
    req.url = req.originalUrl;
    remoteProxy(req, res, next);
  });

  router.get(
    "/:entityName/:id",
    withCollection(async (req, res, collection) => {
      const { entityName, id } = req.params;

      try {
        const doc = await collection.findOneAsync({ id });
        if (!doc) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }
        res.json(stripInternalFields(doc));
      } catch (error) {
        logger.error(`Error in GET /${entityName}/${id}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  router.get(
    "/:entityName",
    withCollection(async (req, res, collection) => {
      const { entityName } = req.params;

      try {
        const { sort, limit, skip, fields, q } = req.query;

        let query = {};
        if (q && typeof q === "string") {
          try {
            query = JSON.parse(q);
          } catch {
            res.status(400).json({ error: "Invalid query parameter 'q'" });
            return;
          }
        }

        let cursor = collection.findAsync(query);

        const sortObj = parseSort(sort as string | undefined);
        if (sortObj) {
          cursor = cursor.sort(sortObj);
        }

        if (skip) {
          const skipNum = Number.parseInt(skip as string, 10);
          if (!Number.isNaN(skipNum)) {
            cursor = cursor.skip(skipNum);
          }
        }

        if (limit) {
          const limitNum = Number.parseInt(limit as string, 10);
          if (!Number.isNaN(limitNum)) {
            cursor = cursor.limit(limitNum);
          }
        }

        const projection = parseFields(fields as string | undefined);
        if (projection) {
          cursor = cursor.projection(projection);
        }

        const docs = await cursor;
        res.json(stripInternalFields(docs));
      } catch (error) {
        logger.error(`Error in GET /${entityName}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  router.post(
    "/:entityName",
    parseBody,
    withCollection(async (req, res, collection) => {
      const { appId, entityName } = req.params;

      try {
        const now = new Date().toISOString();
        const { _id, ...body } = req.body;

        const filteredBody = db.prepareRecord(entityName, body);
        const validation = db.validate(entityName, filteredBody);

        if (validation.hasError) {
          res.status(422).json(validation.error);
          return;
        }

        const record = {
          ...filteredBody,
          id: nanoid(),
          created_date: now,
          updated_date: now,
        };

        const inserted = stripInternalFields(
          await collection.insertAsync(record),
        );
        emit(appId, entityName, "create", inserted);
        res.status(201).json(inserted);
      } catch (error) {
        logger.error(`Error in POST /${entityName}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  router.post(
    "/:entityName/bulk",
    parseBody,
    withCollection(async (req, res, collection) => {
      const { appId, entityName } = req.params;

      if (!Array.isArray(req.body)) {
        res.status(400).json({ error: "Request body must be an array" });
        return;
      }

      try {
        const now = new Date().toISOString();
        const records = [];

        for (const record of req.body) {
          const filteredRecord = db.prepareRecord(entityName, record);
          const validation = db.validate(entityName, filteredRecord);

          if (validation.hasError) {
            res.status(422).json(validation.error);
            return;
          }

          records.push({
            ...filteredRecord,
            id: nanoid(),
            created_date: now,
            updated_date: now,
          });
        }

        const inserted = stripInternalFields(
          await collection.insertAsync(records),
        );
        emit(appId, entityName, "create", inserted);
        res.status(201).json(inserted);
      } catch (error) {
        logger.error(`Error in POST /${entityName}/bulk:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  router.put(
    "/:entityName/:id",
    parseBody,
    withCollection(async (req, res, collection) => {
      const { appId, entityName, id } = req.params;
      const { id: _id, created_date: _created_date, ...body } = req.body;

      try {
        const filteredBody = db.prepareRecord(entityName, body, true);
        const validation = db.validate(entityName, filteredBody, true);

        if (validation.hasError) {
          res.status(422).json(validation.error);
          return;
        }

        const updateData = {
          ...filteredBody,
          updated_date: new Date().toISOString(),
        };

        const result = await collection.updateAsync(
          { id },
          { $set: updateData },
          { returnUpdatedDocs: true },
        );

        if (result.numAffected === 0 || !result.affectedDocuments) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }

        const updated = stripInternalFields(result.affectedDocuments);
        emit(appId, entityName, "update", updated);
        res.json(updated);
      } catch (error) {
        logger.error(`Error in PUT /${entityName}/${id}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  router.delete(
    "/:entityName/:id",
    withCollection(async (req, res, collection) => {
      const { appId, entityName, id } = req.params;

      try {
        const doc = await collection.findOneAsync({ id });
        const numRemoved = await collection.removeAsync(
          { id },
          { multi: false },
        );

        if (numRemoved === 0) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }

        if (doc) {
          emit(appId, entityName, "delete", stripInternalFields(doc));
        }
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error in DELETE /${entityName}/${id}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  router.delete(
    "/:entityName",
    parseBody,
    withCollection(async (req, res, collection) => {
      const { entityName } = req.params;

      try {
        const query = req.body || {};
        const numRemoved = await collection.removeAsync(query, { multi: true });
        res.json({ success: true, deleted: numRemoved });
      } catch (error) {
        logger.error(`Error in DELETE /${entityName}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  return router;
}
