import { nanoid } from "nanoid";
import type { Entity } from "@/core/resources/entity/schema.js";
import type { Database } from "./database.js";
import { applyFLS } from "./rls.js";
import type { EntityRecord } from "./validator.js";

export interface RecordOwner {
  email: string;
  id: string;
}

export interface PrepareRecordForCreateOptions {
  /** Principal used for field-level security (service role bypasses FLS). */
  actor: Record<string, unknown> | undefined;
  /** Identity stamped into created_by/created_by_id; omit for none. */
  owner: RecordOwner | undefined;
  now: string;
  /** Stable id override (seed fixtures); defaults to a fresh nanoid. */
  id?: string;
}

/**
 * Assemble a record for insertion exactly like the entity POST route: filter
 * to schema fields, apply defaults, validate (throws EntityValidationError),
 * then stamp id, owner, and timestamps. RLS is the caller's concern.
 */
export function prepareRecordForCreate(
  db: Database,
  entityName: string,
  schema: Entity,
  body: EntityRecord,
  { actor, owner, now, id }: PrepareRecordForCreateOptions,
): EntityRecord {
  const { _id, ...recordBody } = body;
  const filteredBody = applyFLS(
    db.prepareRecord(entityName, recordBody),
    schema,
    actor,
    "write",
  );
  db.validate(entityName, filteredBody);

  return {
    ...filteredBody,
    id: id ?? nanoid(),
    ...(owner ? { created_by: owner.email, created_by_id: owner.id } : {}),
    created_date: now,
    updated_date: now,
  };
}
