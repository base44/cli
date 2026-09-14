import { buildHyperdrivePrivateDataSource } from "./hyperdrive";
import { privateDataSourceReference } from "./manifest";

export function mysql(name: unknown) {
  return buildHyperdrivePrivateDataSource(
    privateDataSourceReference(name, "mysql"),
  );
}
