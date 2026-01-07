import ky from "ky";
import { getBase44ApiUrl } from "../consts.js";

/**
 * Separate ky instance for OAuth endpoints.
 * These don't need Authorization headers (they use client_id + tokens in body).
 */
const authClient = ky.create({
  prefixUrl: getBase44ApiUrl(),
  headers: {
    "User-Agent": "Base44 CLI",
  },
});

export default authClient;

