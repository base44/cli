import { buildTediousConnectorFactory } from "./tedious-adapter";
import { privateDataSourceReference } from "./manifest";
import { buildTcpPrivateDataSource } from "./tcp";

export function sqlserver(name: unknown) {
  const source = buildTcpPrivateDataSource(
    privateDataSourceReference(name, "sqlserver"),
  ) as ReturnType<typeof buildTcpPrivateDataSource> & {
    connect: (options?: unknown) => unknown;
  };
  const extension = {
    tediousConnector() {
      return buildTediousConnectorFactory(() => source.connect());
    },
  };
  return Object.freeze(
    Object.defineProperties(
      extension,
      Object.getOwnPropertyDescriptors(source),
    ) as typeof source & typeof extension,
  );
}
