// The JWT helpers moved to core so the seed-script runner (core layer) can
// mint local service tokens; this re-export keeps dev-server imports stable.
export {
  createJwtToken,
  createServiceAuthorizationHeader,
  isServiceSubject,
  SERVICE_ROLE_EMAIL,
} from "@/core/local-state/tokens.js";
