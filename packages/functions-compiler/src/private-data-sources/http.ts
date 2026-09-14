import { buildHttpPrivateDataSource } from "./build-http";
import { privateDataSourceReference } from "./manifest";

export function http(name: unknown) {
  return buildHttpPrivateDataSource(privateDataSourceReference(name, "http"));
}
