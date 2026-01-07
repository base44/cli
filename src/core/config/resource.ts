export interface Resource<T> {
  readAll: (dir: string) => Promise<T[]>;
}
