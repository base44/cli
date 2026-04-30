import type Datastore from "@seald-io/nedb";
import type { Request, Response, Router } from "express";
import { Router as createRouter, json } from "express";
import { nanoid } from "nanoid";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import type { Database } from "@/cli/dev/dev-server/db/database.js";
import { applyFLS, checkRLS } from "@/cli/dev/dev-server/db/rls.js";
import {
  type EntityRecord,
  EntityValidationError,
} from "@/cli/dev/dev-server/db/validator.js";
import type {
  BroadcastEntityEvent,
  EntityEventType,
} from "@/cli/dev/dev-server/realtime.js";
import { stripInternalFields } from "@/cli/dev/dev-server/utils.js";
import { InvalidInputError } from "@/core/errors.js";
import type { Entity } from "@/core/resources/entity/schema.js";
import { queryEntity } from "../../db/entity-queries.js";
import { resolveCurrentUser, type UserDocument } from "./current-user.js";
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
      schema: Entity,
      currentUser: UserDocument | undefined,
    ) => Promise<void> | void,
  ): (req: Request<EntityParams>, res: Response) => Promise<void> {
    return async (req, res) => {
      const { entityName } = req.params;
      const collection = db.getCollection(entityName);
      if (!collection) {
        res.status(404).json({ error: `Entity "${entityName}" not found` });
        return;
      }
      const schema = db.getSchema(entityName);
      if (!schema) {
        res.status(404).json({ error: `Schema for "${entityName}" not found` });
        return;
      }
      const currentUserResult = await resolveCurrentUser(db, req);
      const currentUser = currentUserResult.ok
        ? currentUserResult.user
        : undefined;

      await handler(req, res, collection, schema, currentUser);
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

  function prepareCreateRecord(
    entityName: string,
    body: EntityRecord,
    schema: Entity,
    currentUser: UserDocument | undefined,
    now: string,
  ): EntityRecord | undefined {
    const { _id, ...recordBody } = body;
    const ownerFields = {
      created_by: currentUser?.email,
      created_by_id: currentUser?.id,
    };

    if (
      !checkRLS(
        schema.rls?.create,
        {
          ...recordBody,
          ...ownerFields,
        },
        currentUser,
      )
    ) {
      return undefined;
    }

    const filteredBody = applyFLS(
      db.prepareRecord(entityName, recordBody),
      schema,
      currentUser,
      "write",
    );
    db.validate(entityName, filteredBody);

    return {
      ...filteredBody,
      id: nanoid(),
      ...ownerFields,
      created_date: now,
      updated_date: now,
    };
  }

  const userRouter = createUserRouter(db, logger);
  router.use("/User", userRouter);

  router.get(
    "/:entityName/:id",
    withCollection(async (req, res, collection, schema, currentUser) => {
      const { entityName, id } = req.params;

      try {
        const doc = await collection.findOneAsync({ id });
        if (!doc) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }

        if (!checkRLS(schema.rls?.read, doc, currentUser)) {
          res.status(404).json({
            message: `Entity ${entityName} with ID ${id} not found`,
          });
          return;
        }

        const result = applyFLS(
          stripInternalFields(doc),
          schema,
          currentUser,
          "read",
        );

        res.json(result);
      } catch (error) {
        logger.error(`Error in GET /${entityName}/${id}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  router.get(
    "/:entityName",
    withCollection(async (req, res, collection, schema, currentUser) => {
      const { entityName } = req.params;

      try {
        let results = stripInternalFields(
          await queryEntity(collection, req.query),
        );

        if (schema.rls?.read && schema.rls.read !== true) {
          results = results.filter((doc) =>
            checkRLS(schema.rls!.read, doc, currentUser),
          );
        }

        results = results.map((doc) =>
          applyFLS(doc, schema, currentUser, "read"),
        );

        res.json(results);
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
    withCollection(async (req, res, collection, schema, currentUser) => {
      const { appId, entityName } = req.params;

      try {
        const now = new Date().toISOString();
        const record = prepareCreateRecord(
          entityName,
          req.body,
          schema,
          currentUser,
          now,
        );
        if (!record) {
          res.status(403).json({ error: "Permission denied" });
          return;
        }

        const inserted = applyFLS(
          stripInternalFields(await collection.insertAsync(record)),
          schema,
          currentUser,
          "read",
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
    withCollection(async (req, res, collection, schema, currentUser) => {
      const { appId, entityName } = req.params;

      if (!Array.isArray(req.body)) {
        res.status(400).json({ error: "Request body must be an array" });
        return;
      }

      try {
        const now = new Date().toISOString();
        const records: EntityRecord[] = [];

        for (const body of req.body) {
          const record = prepareCreateRecord(
            entityName,
            body,
            schema,
            currentUser,
            now,
          );
          if (!record) {
            res.status(403).json({ error: "Permission denied" });
            return;
          }

          records.push(record);
        }

        const inserted = applyFLS(
          stripInternalFields(await collection.insertAsync(records)),
          schema,
          currentUser,
          "read",
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
    withCollection(async (req, res, collection, schema, currentUser) => {
      const { appId, entityName, id } = req.params;
      const { id: _id, created_date: _created_date, ...body } = req.body;

      try {
        if (schema.rls?.update !== undefined) {
          const existing = await collection.findOneAsync({ id });
          if (!existing) {
            res.status(404).json({ error: `Record with id "${id}" not found` });
            return;
          }
          if (!checkRLS(schema.rls.update, existing, currentUser)) {
            res.status(404).json({
              message: `Entity ${entityName} with ID ${id} not found`,
            });
            return;
          }
        }

        const filteredBody = applyFLS(
          db.prepareRecord(entityName, body, true),
          schema,
          currentUser,
          "write",
        );
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

        const updated = applyFLS(
          stripInternalFields(result.affectedDocuments),
          schema,
          currentUser,
          "read",
        );
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
    withCollection(async (req, res, collection, schema, currentUser) => {
      const { appId, entityName, id } = req.params;

      try {
        const doc = await collection.findOneAsync({ id });
        if (!doc) {
          res.status(404).json({ error: `Record with id "${id}" not found` });
          return;
        }

        if (!checkRLS(schema.rls?.delete, doc, currentUser)) {
          res.status(404).json({
            message: `Entity ${entityName} with ID ${id} not found`,
          });
          return;
        }

        await collection.removeAsync({ id }, { multi: false });
        emit(appId, entityName, "delete", stripInternalFields(doc));
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
    withCollection(async (req, res, collection, schema, currentUser) => {
      const { entityName } = req.params;

      try {
        const query = req.body || {};
        const rlsDelete = schema?.rls?.delete;

        // When RLS has a condition, find matching records and only delete allowed ones
        if (rlsDelete !== undefined && rlsDelete !== true) {
          if (rlsDelete === false) {
            res.status(403).json({ error: "Permission denied" });
            return;
          }

          const docs = await collection.findAsync(query);
          const allowedIds = docs
            .filter((doc) => checkRLS(rlsDelete, doc, currentUser))
            .map((doc) => (doc as Record<string, unknown>).id);

          const numRemoved = await collection.removeAsync(
            { id: { $in: allowedIds } },
            { multi: true },
          );
          res.json({ success: true, deleted: numRemoved });
        } else {
          const numRemoved = await collection.removeAsync(query, {
            multi: true,
          });
          res.json({ success: true, deleted: numRemoved });
        }
      } catch (error) {
        logger.error(`Error in DELETE /${entityName}:`, error);
        res.status(500).json({ error: "Internal server error" });
      }
    }),
  );

  return router;
}
