import { buildHttpPrivateDataSource } from "./build-http";
import { privateDataSourceReference } from "./manifest";

export function elasticsearch(name: unknown) {
  return buildHttpPrivateDataSource(
    privateDataSourceReference(name, "elasticsearch"),
  );
}
