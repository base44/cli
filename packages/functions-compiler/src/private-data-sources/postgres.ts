import { buildHyperdrivePrivateDataSource } from "./hyperdrive";
import { privateDataSourceReference } from "./manifest";

export function postgres(name: unknown) {
  return buildHyperdrivePrivateDataSource(
    privateDataSourceReference(name, "postgres"),
  );
}
