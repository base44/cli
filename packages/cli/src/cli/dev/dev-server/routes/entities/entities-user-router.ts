import type { Request, Response, Router } from "express";
import { Router as createRouter, json } from "express";
import { nanoid } from "nanoid";
import type { Logger } from "@/cli/dev/createDevLogger.js";
import { readAuth } from "@/core/index.js";
import { type Database, USER_COLLECTION } from "../../db/database.js";
import {
  type EntityRecord,
  EntityValidationError,
} from "../../db/validator.js";
import { getNowISOTimestamp, stripInternalFields } from "../../utils.js";

export function createUserRouter(db: Database, logger: Logger): Router {
  const router = createRouter({ mergeParams: true });
  const parseBody = json();

  router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
    let result: Record<string, unknown> | undefined;

    if (req.params.id === "me") {
      const userInfo = await readAuth();
      result = await db
        .getCollection(USER_COLLECTION)
        ?.findOneAsync({ email: userInfo.email });
    } else {
      result = await db
        .getCollection(USER_COLLECTION)
        ?.findOneAsync({ id: req.params.id });
    }

    if (!result) {
      res
        .status(404)
        .json({ error: `User with id "${req.params.id}" not found` });
      return;
    }
    res.json(stripInternalFields(result));
  });

  router.post("/", parseBody, async (req, res) => {
    const userInfo = await readAuth();
    const currentUser = await db
      .getCollection(USER_COLLECTION)
      ?.findOneAsync({ email: userInfo.email });

    if (currentUser) {
      const now = getNowISOTimestamp();

      // Production is not allowing to add user entity directly.
      // In case developer tries to do it - backend silently fails.
      res.json({
        created_by: userInfo.email,
        created_by_id: currentUser.id,
        id: nanoid(),
        created_date: now,
        updated_date: now,
        is_sample: false,
        ...req.body,
      });
    } else {
      res
        .status(404)
        .json({ error: "Unable to read data for the current user" });
    }
  });

  router.post("/bulk", async (_req, res) => {
    // not supported in direct call: NO-OP
    res.json({});
  });

  router.put("/:id", parseBody, async (req: Request<{ id: string }>, res) => {
    // These fields are built-in in the schema, but user still can not update them using Entities API
    const restrictedFields = ["full_name", "email", "role"];
    const collection = db.getCollection(USER_COLLECTION);
    const userInfo = await readAuth();
    const userRecord =
      req.params.id === "me"
        ? await collection?.findOneAsync({
            email: userInfo.email,
          })
        : await collection?.findOneAsync({
            id: req.params.id,
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
  });

  router.delete("/:id", async (_req, res) => {
    // not supported in direct call: NO-OP
    res.json({});
  });

  return router;
}
