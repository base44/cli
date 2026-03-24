import type Datastore from "@seald-io/nedb";
import type { Request, Response, Router } from "express";
import { Router as createRouter, json } from "express";
import { nanoid } from "nanoid";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import type { Database } from "@/cli/dev/dev-server/db/database.js";
import { EntityValidationError } from "@/cli/dev/dev-server/db/validator.js";
import type {
  BroadcastEntityEvent,
  EntityEventType,
} from "@/cli/dev/dev-server/realtime.js";
import { stripInternalFields } from "@/cli/dev/dev-server/utils.js";
import { InvalidInputError } from "@/core/errors.js";
import { queryEntity } from "../../db/entity-queries.js";
import { createUserRouter } from "./entities-user-router.js";

interface EntityParams {
  appId: string;
  entityName: string;
  id?: string;
}

export async function createEntityRoutes(
  db: Database,
  logger: DevLogger,
  broadcast: BroadcastEntityEvent,
): Promise<Router> {
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

  const userRouter = createUserRouter(db, logger);
  router.use("/User", userRouter);

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
        res.json(stripInternalFields(await queryEntity(collection, req.query)));
      } catch (error) {
        if (error instanceof InvalidInputError) {
          res.status(400).json({ error: error.message });
        } else {
          logger.error(`Error in GET /${entityName}:`, error);
          res.status(500).json({ error: "Internal server error" });
        }
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
        db.validate(entityName, filteredBody);

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
        if (error instanceof EntityValidationError) {
          res.status(422).json(error.context);
          return;
        }
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
          db.validate(entityName, filteredRecord);

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
        if (error instanceof EntityValidationError) {
          res.status(422).json(error.context);
          return;
        }
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
        db.validate(entityName, filteredBody, true);

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
        if (error instanceof EntityValidationError) {
          res.status(422).json(error.context);
          return;
        }
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
