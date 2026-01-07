export interface Resource<T> {
  name: string;
  readAll(dir: string): Promise<T[]>;
}

