import { buildHyperdrivePrivateDataSource } from "./hyperdrive";
import { privateDataSourceReference } from "./manifest";

export function mariadb(name: unknown) {
  return buildHyperdrivePrivateDataSource(
    privateDataSourceReference(name, "mariadb"),
  );
}
