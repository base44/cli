export interface Resource<T> {
  readAll: (dir: string) => Promise<T[]>;
  push?: (items: T[]) => Promise<unknown>;
}
