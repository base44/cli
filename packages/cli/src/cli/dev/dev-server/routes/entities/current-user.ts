import type { Document } from "@seald-io/nedb";
import type { Request } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import {
  type Database,
  USER_COLLECTION,
} from "@/cli/dev/dev-server/db/database.js";

export type UserDocument = Document<{
  email: string;
  id: string;
  role: "admin" | "user";
}>;

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

    const currentUser = await db
      .getCollection(USER_COLLECTION)
      ?.findOneAsync<UserDocument>({ email: subject });

    if (!currentUser) {
      return { ok: false, reason: "not_found" };
    }

    return { ok: true, user: currentUser };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
