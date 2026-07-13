import type Datastore from "@seald-io/nedb";
import { getNowISOTimestamp } from "../utils.js";

export interface BuildUserDocumentOptions {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "user";
  /** Preserve the original creation timestamp when updating an existing user. */
  createdDate?: string;
}

/** Derive the default full name from an email, like OTP registration does. */
export function fullNameFromEmail(email: string): string {
  const match = /^([^@]+)/.exec(email);
  return match ? match[1] : email;
}

/**
 * Canonical local user document. Single shape shared by the CLI bootstrap
 * user, OTP registration, and seeding so all local users look alike.
 */
export function buildUserDocument({
  id,
  email,
  fullName,
  role,
  createdDate,
}: BuildUserDocumentOptions): Record<string, unknown> {
  const now = getNowISOTimestamp();
  return {
    id,
    email,
    full_name: fullName,
    is_service: false,
    is_verified: true,
    disabled: null,
    role,
    collaborator_role: "editor",
    created_date: createdDate ?? now,
    updated_date: now,
  };
}

/**
 * Store login credentials in the private user collection the same way
 * `/register` does (minus the OTP step), so `/login` accepts the password.
 */
export async function upsertUserCredentials(
  privateUserCollection: Datastore,
  { id, email, password }: { id: string; email: string; password: string },
): Promise<void> {
  await privateUserCollection.updateAsync(
    { email },
    { $set: { id, email, password, createdAt: Date.now() } },
    { upsert: true },
  );
}
