import type { Document } from "@seald-io/nedb";
import type { Request } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { nanoid } from "nanoid";
import {
  isServiceSubject,
  SERVICE_ROLE_EMAIL,
} from "@/cli/dev/dev-server/auth/tokens.js";
import {
  type Database,
  USER_COLLECTION,
} from "@/cli/dev/dev-server/db/database.js";
import {
  deriveFullNameFromEmail,
  getNowISOTimestamp,
} from "@/cli/dev/dev-server/utils.js";

export type UserDocument = Document<{
  email: string;
  id: string;
  is_service?: boolean;
  role: "admin" | "user";
}>;

const SERVICE_USER: UserDocument = {
  _id: "service-role",
  id: "service-role",
  email: SERVICE_ROLE_EMAIL,
  role: "admin",
  is_service: true,
};

type CurrentUserLookupResult =
  | { ok: true; user: UserDocument }
  | { ok: false; reason: "missing" | "invalid" | "not_found" };

function getSubject(payload?: JwtPayload | string): string | undefined {
  if (!payload || typeof payload === "string") {
    return undefined;
  }

  return payload.sub;
}

export async function resolveCurrentUser(
  db: Database,
  req: Pick<Request, "headers">,
): Promise<CurrentUserLookupResult> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing" };
  }

  try {
    const decoded = jwt.decode(auth.replace("Bearer ", ""), {
      complete: true,
    });
    const subject = getSubject(decoded?.payload);

    if (!subject) {
      return { ok: false, reason: "invalid" };
    }

    if (isServiceSubject(subject)) {
      return { ok: true, user: SERVICE_USER };
    }

    const currentUser = await db
      .getCollection(USER_COLLECTION)
      ?.findOneAsync<UserDocument>({ email: subject });

    if (currentUser) {
      return { ok: true, user: currentUser };
    }

    // Tokens minted by production (e.g. Google OAuth round-trips) carry
    // subjects that never registered locally — create them on first sight so
    // the session works instead of 404ing on User/me.
    const externallyAuthenticatedUser = await createLocalUser(db, subject);

    if (!externallyAuthenticatedUser) {
      return { ok: false, reason: "not_found" };
    }

    return { ok: true, user: externallyAuthenticatedUser };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

async function createLocalUser(
  db: Database,
  email: string,
): Promise<UserDocument | undefined> {
  const collection = db.getCollection(USER_COLLECTION);
  if (!collection) {
    return undefined;
  }

  const now = getNowISOTimestamp();
  const inserted = await collection.insertAsync({
    id: nanoid(),
    email,
    full_name: deriveFullNameFromEmail(email),
    is_service: false,
    is_verified: true,
    disabled: null,
    role: "user",
    collaborator_role: "editor",
    created_date: now,
    updated_date: now,
  });

  return inserted as unknown as UserDocument;
}
