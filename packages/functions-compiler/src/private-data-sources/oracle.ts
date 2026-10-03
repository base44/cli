import { createHash } from "node:crypto";

import { privateDataSourceReference } from "./manifest";
import { installPrivateNodeNetAdapter, registerPrivateNodeNetRoute } from "./node-net-adapter";
import { buildTcpPrivateDataSource } from "./tcp";

export function oracle(name: unknown) {
  installPrivateNodeNetAdapter();
  const entry = privateDataSourceReference(name, "oracle");
  const source = buildTcpPrivateDataSource(entry);
  // A numeric alias avoids Oracle's client-side DNS lookup of private hostnames.
  const hash = createHash("sha256").update(String(entry.name)).digest("hex").slice(0, 28);
  const driverHost = `fd44:${hash.match(/.{4}/g)!.join(":")}`;

  const extension = {
    oracledbOptions() {
      const serviceName = source.database;
      if (!serviceName || !/^[a-zA-Z0-9_.$#-]+$/.test(serviceName)) {
        throw new Error("Enter an Oracle service name using letters, numbers, underscores, dots, $, #, or hyphens.");
      }
      const port = source.port!;
      registerPrivateNodeNetRoute(driverHost, port, {
        label: `Oracle private data source "${entry.name}"`,
        connect: () => source.connect(),
      });
      return Object.freeze({
        user: source.username,
        password: source.password,
        connectString: `(DESCRIPTION=(TRANSPORT_CONNECT_TIMEOUT=10)(CONNECT_TIMEOUT=15)(RETRY_COUNT=0)(ADDRESS=(PROTOCOL=TCP)(HOST=${driverHost})(PORT=${port}))(CONNECT_DATA=(SERVICE_NAME=${serviceName})(SERVER=DEDICATED)))`,
      });
    },
  };
  return Object.freeze(Object.defineProperties(extension, Object.getOwnPropertyDescriptors(source)) as typeof source & typeof extension);
}
