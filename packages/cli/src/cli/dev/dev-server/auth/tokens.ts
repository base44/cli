import jwt from "jsonwebtoken";

const LOCAL_DEV_SECRET = "LOCAL_DEV_SECRET";

/**
 * Sentinel identity used for service-role (`asServiceRole`) requests in dev.
 * In production Base44 injects a privileged service token; locally we mint a
 * JWT for this subject and grant it full access (see `checkRLS`).
 */
export const SERVICE_ROLE_EMAIL = "server@server.com";

export const createJwtToken = (email: string) => {
  return jwt.sign({ sub: email }, LOCAL_DEV_SECRET, {
    expiresIn: "360d",
  });
};

/**
 * Mints the service-role JWT injected as `Base44-Service-Authorization` so
 * `asServiceRole` works locally regardless of how the caller is authenticated.
 */
const createServiceToken = () => createJwtToken(SERVICE_ROLE_EMAIL);

export const createServiceAuthorizationHeader = () =>
  `Bearer ${createServiceToken()}`;

/** True when a JWT subject identifies the service-role principal. */
export const isServiceSubject = (subject: string): boolean =>
  subject === SERVICE_ROLE_EMAIL;
