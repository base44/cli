export interface PrivateDataSourceManifestEntry {
  name?: string;
  type?: string;
  bindingName?: string;
  bindingKind?: string;
  networkScope?: string;
  baseUrl?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
}

export interface FetchPrivateDataSourceBinding {
  fetch: (resource: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
}

export interface TcpPrivateDataSourceBinding {
  connect: (address: unknown, options?: unknown) => unknown;
}

export interface CloudflareTcpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened?: Promise<unknown>;
  close?: () => void;
  closed?: Promise<unknown>;
}
