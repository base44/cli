import type { Base44Client } from "@base44/sdk";

/** Minimal typed views over the SDK's dynamically-typed surface, so dev tests
 * can read entities / the current user without sprinkling `as any`. */
export type Row = Record<string, unknown>;

export interface EntityApi {
  list(): Promise<Row[]>;
  create(data: Row): Promise<Row>;
}

export function entities(client: Base44Client): Record<string, EntityApi> {
  return client.entities as unknown as Record<string, EntityApi>;
}

export interface MeUser {
  email: string;
  role: string;
}

export function asUser(value: unknown): MeUser {
  return value as MeUser;
}
