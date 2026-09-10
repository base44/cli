import {
  currentPrivateDataSource,
  normalizePrivateDataSourceKey,
  privateDataSourceReference,
} from "./manifest";
import { buildTcpPrivateDataSource } from "./tcp";
import { installPrivateNodeNetAdapter, registerPrivateNodeNetRoute } from "./node-net-adapter";
import type { PrivateDataSourceManifestEntry } from "./types";

function encodeMongoConnectionPart(value: unknown): string {
  return encodeURIComponent(String(value ?? ""));
}

function buildMongoConnectionString(entry: PrivateDataSourceManifestEntry, hostname: string): string {
  const username = entry.username ? encodeMongoConnectionPart(entry.username) : "";
  const password = entry.password ? encodeMongoConnectionPart(entry.password) : "";
  const auth = username ? `${username}${password ? `:${password}` : ""}@` : "";
  const database = entry.database ? `/${encodeMongoConnectionPart(entry.database)}` : "";
  const port = typeof entry.port === "number" ? entry.port : 27017;
  return `mongodb://${auth}${hostname}:${port}${database}?directConnection=true`;
}

export function mongodb(name: unknown) {
  installPrivateNodeNetAdapter();
  const entry = privateDataSourceReference(name, "mongodb");
  const source = buildTcpPrivateDataSource(entry) as ReturnType<typeof buildTcpPrivateDataSource> & {
    connect: (options?: unknown) => unknown;
  };
  const driverHostname = `base44-private-${normalizePrivateDataSourceKey(
    entry.bindingName || entry.name || "mongodb",
  )}`;

  function registerRoute() {
    const current = currentPrivateDataSource(entry);
    const port = typeof current.port === "number" ? current.port : 27017;
    const label = `MongoDB private data source "${current.name || current.bindingName || driverHostname}"`;
    registerPrivateNodeNetRoute(driverHostname, port, {
      label,
      connect: () => source.connect(),
    });
  }

  const extension = {
    driverHost: driverHostname,
    get connectionString() {
      const current = currentPrivateDataSource(entry);
      registerRoute();
      return buildMongoConnectionString(current, driverHostname);
    },
    get uri() {
      const current = currentPrivateDataSource(entry);
      registerRoute();
      return buildMongoConnectionString(current, driverHostname);
    },
    mongoClientOptions(options?: Record<string, unknown>) {
      registerRoute();
      return Object.freeze({
        directConnection: true,
        serverSelectionTimeoutMS: 5000,
        ...options,
      });
    },
  };
  return Object.freeze(
    Object.defineProperties(
      extension,
      Object.getOwnPropertyDescriptors(source),
    ) as typeof source & typeof extension,
  );
}
