import { InvalidInputError } from "@/core/errors.js";
import { normalizeSeedName } from "@/core/resources/seed/index.js";
import { stripInternalFields } from "../utils.js";
import { type Database, USER_COLLECTION } from "./database.js";
import type { EntityRecord } from "./validator.js";

export type CollectionsExport = Record<string, EntityRecord[]>;

/**
 * Read local collections for `data dump`, keyed by entity display name and
 * stripped of NeDB's `_id`. By default the user collection is excluded (user
 * fixtures are users.jsonc-shaped, not entity fixtures); naming an entity
 * explicitly includes exactly the requested collections.
 */
export async function exportCollections(
  db: Database,
  entityNames?: string[],
): Promise<CollectionsExport> {
  const available = new Map<
    string,
    { displayName: string; collection: string }
  >();
  for (const collection of db.getCollectionNames()) {
    const displayName = db.getSchema(collection)?.name ?? collection;
    available.set(normalizeSeedName(displayName), { displayName, collection });
  }

  const selected = entityNames?.length
    ? entityNames.map((entityName) => {
        const match = available.get(normalizeSeedName(entityName));
        if (!match) {
          throw new InvalidInputError(`Unknown entity "${entityName}"`);
        }
        return match;
      })
    : [...available.values()].filter(
        ({ collection }) => collection !== USER_COLLECTION,
      );

  const result: CollectionsExport = {};
  for (const { displayName, collection } of selected) {
    const docs =
      (await db.getCollection(collection)?.findAsync<EntityRecord>({})) ?? [];
    result[displayName] = stripInternalFields(docs);
  }
  return result;
}
