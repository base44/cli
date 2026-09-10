import {
  currentPrivateDataSource,
  privateDataSourceReference,
  privateDataSourceBinding,
} from "./manifest";
import type {
  CloudflareTcpSocket,
  PrivateDataSourceManifestEntry,
  TcpPrivateDataSourceBinding,
} from "./types";

function hasConnect(binding: unknown): binding is TcpPrivateDataSourceBinding {
  return (
    binding !== null &&
    typeof binding === "object" &&
    typeof (binding as { connect?: unknown }).connect === "function"
  );
}

export function buildTcpPrivateDataSource(entry: PrivateDataSourceManifestEntry) {
  return Object.freeze({
    name: entry.name,
    type: entry.type,
    get bindingName() {
      return currentPrivateDataSource(entry).bindingName;
    },
    get host() {
      return currentPrivateDataSource(entry).host;
    },
    get port() {
      return currentPrivateDataSource(entry).port;
    },
    get database() {
      return currentPrivateDataSource(entry).database;
    },
    get username() {
      return currentPrivateDataSource(entry).username;
    },
    get user() {
      return currentPrivateDataSource(entry).username;
    },
    get password() {
      return currentPrivateDataSource(entry).password;
    },
    connect(options?: unknown) {
      const current = currentPrivateDataSource(entry);
      const binding = privateDataSourceBinding(current);
      if (!hasConnect(binding)) {
        throw new Error(
          `Private data source "${current.name}" does not expose connect()`,
        );
      }
      const address =
        typeof current.host === "string" && typeof current.port === "number"
          ? { hostname: current.host, port: current.port }
          : null;
      if (!address) {
        throw new Error(
          `Private data source "${current.name}" has no TCP address`,
        );
      }
      return binding.connect(address, options);
    },
    get binding() {
      return privateDataSourceBinding(entry);
    },
  });
}

export function isCloudflareTcpSocket(socket: unknown): socket is CloudflareTcpSocket {
  const socketObject = socket as Partial<CloudflareTcpSocket> | null;
  return (
    socketObject !== null &&
    typeof socketObject === "object" &&
    !!socketObject.readable &&
    typeof socketObject.readable.getReader === "function" &&
    !!socketObject.writable &&
    typeof socketObject.writable.getWriter === "function"
  );
}

export function tcp(name: unknown, expectedType: string) {
  return buildTcpPrivateDataSource(
    privateDataSourceReference(name, expectedType),
  );
}
