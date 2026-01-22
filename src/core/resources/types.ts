/**
 * Base interface for all project resources (entities, functions, etc.).
 * Resources are project-specific collections that can be loaded from the filesystem
 * and pushed to the Base44 API.
 *
 * @template T - The type of items in this resource collection
 */
export interface Resource<T> {
  /**
   * Read all items of this resource type from a directory.
   * @param dir - The directory to read from
   * @returns Array of parsed and validated items
   */
  readAll: (dir: string) => Promise<T[]>;

  /**
   * Push items to the Base44 API.
   * @param items - The items to push
   * @returns API response
   */
  push: (items: T[]) => Promise<unknown>;
}
