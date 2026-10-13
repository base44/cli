export interface StaticEgressAddress {
  hostname: string;
  port: number;
}

export interface StaticEgressOptions {
  secureTransport?: "off";
}

export interface StaticEgressSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<{ remoteAddress?: string | null; localAddress?: string | null }>;
  closed: Promise<void>;
  close(): Promise<void>;
}

export function createStaticEgress(
  readEnvironment: () => Record<string, unknown> | undefined,
): {
  connect(address: StaticEgressAddress, options?: StaticEgressOptions): Promise<StaticEgressSocket>;
};
