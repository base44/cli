import type { Document } from "@seald-io/nedb";
import type { Request, Response, Router } from "express";
import { Router as createRouter, json } from "express";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import {
  type Database,
  USER_COLLECTION,
} from "@/cli/dev/dev-server/db/database.js";
import {
  type EntityRecord,
  EntityValidationError,
} from "@/cli/dev/dev-server/db/validator.js";
import {
  getNowISOTimestamp,
  stripInternalFields,
} from "@/cli/dev/dev-server/utils.js";

type UserDocument = Document<{
  email: string;
  id: string;
}>;

export function createUserRouter(db: Database, logger: DevLogger): Router {
  const router = createRouter({ mergeParams: true });
  const parseBody = json();

  function withAuth<R>(
    handler: (
      req: Request<R>,
      res: Response,
      currentUser: UserDocument,
    ) => Promise<void> | void,
  ): (req: Request<R>, res: Response) => Promise<void> {
    return async (req, res) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        const { payload } =
          jwt.decode(auth.replace("Bearer ", ""), { complete: true }) ?? {};

        const result = await db
          .getCollection(USER_COLLECTION)
          ?.findOneAsync({ email: payload?.sub });

        if (!result) {
          res
            .status(404)
            .json({ error: "Unable to read data for the current user" });
          return;
        }

        await handler(req, res, result as UserDocument);
      } catch {
        res.status(401).json({ error: "Unauthorized" });
      }
    };
  }

  router.get(
    "/:id",
    withAuth<{ id: string }>(async (req, res, currentUser) => {
      const id = req.params.id === "me" ? currentUser.id : req.params.id;
      const result = await db
        .getCollection(USER_COLLECTION)
        ?.findOneAsync({ id });

      if (!result) {
        res
          .status(404)
          .json({ error: `User with id "${req.params.id}" not found` });
        return;
      }
      res.json(stripInternalFields(result));
    }),
  );

  router.post(
    "/",
    parseBody,
    withAuth(async (req, res, currentUser) => {
      const now = getNowISOTimestamp();

      // Production is not allowing to add user entity directly.
      // In case developer tries to do it - backend silently fails.
      res.json({
        created_by: currentUser.email,
        created_by_id: currentUser.id,
        id: nanoid(),
        created_date: now,
        updated_date: now,
        is_sample: false,
        ...req.body,
      });
    }),
  );

  router.post("/bulk", async (_req, res) => {
    // not supported in direct call: NO-OP
    res.json({});
  });

  router.put(
    "/:id",
    parseBody,
    withAuth<{ id: string }>(async (req, res, currentUser) => {
      // These fields are built-in in the schema, but user still can not update them using Entities API
      const restrictedFields = ["full_name", "email", "role"];
      const collection = db.getCollection(USER_COLLECTION);
      const id = req.params.id === "me" ? currentUser.id : req.params.id;
      const userRecord = await collection?.findOneAsync({
        id,
      });
      if (userRecord) {
        try {
          const { id: _id, created_date: _created_date, ...body } = req.body;
          const filteredBody = db.prepareRecord(USER_COLLECTION, body, true);
          const allowedFields: EntityRecord = {};
          for (const [key, property] of Object.entries(filteredBody)) {
            if (!restrictedFields.includes(key)) {
              allowedFields[key] = property;
            }
          }
          db.validate(USER_COLLECTION, allowedFields, true);

          const updateData = {
            ...allowedFields,
            updated_date: new Date().toISOString(),
          };

          const updResult = await collection?.updateAsync(
            { id: userRecord.id },
            { $set: updateData },
            { returnUpdatedDocs: true },
          );

          if (!updResult?.affectedDocuments) {
            throw new Error(`Failed to update user`);
          }

          res.json(stripInternalFields(updResult.affectedDocuments));
        } catch (error) {
          if (error instanceof EntityValidationError) {
            res.status(422).json(error.context);
            return;
          }
          logger.error(
            `Error in PUT /${USER_COLLECTION}/${req.params.id}:`,
            error,
          );
          res.status(500).json({ error: "Internal server error" });
        }
      } else {
        res.status(404).json({ error: `User record not found` });
      }
    }),
  );

  router.delete("/:id", async (_req, res) => {
    // not supported in direct call: NO-OP
    res.json({});
  });

  return router;
}
