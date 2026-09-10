import {
  currentPrivateDataSource,
  privateDataSourceReference,
  privateDataSourceBinding,
} from "./manifest";
import type { PrivateDataSourceManifestEntry } from "./types";

export function buildHyperdrivePrivateDataSource(entry: PrivateDataSourceManifestEntry) {
  const binding = () =>
    privateDataSourceBinding(entry) as Record<string, unknown>;
  return Object.freeze({
    name: entry.name,
    type: entry.type,
    get bindingName() {
      return currentPrivateDataSource(entry).bindingName;
    },
    get connectionString() {
      return binding().connectionString;
    },
    get host() {
      return binding().host;
    },
    get port() {
      return binding().port;
    },
    get user() {
      return binding().user;
    },
    get username() {
      return binding().user;
    },
    get password() {
      return binding().password;
    },
    get database() {
      return binding().database;
    },
    get binding() {
      return binding();
    },
  });
}

export function hyperdrive(name: unknown) {
  return buildHyperdrivePrivateDataSource(
    privateDataSourceReference(name, "hyperdrive"),
  );
}
