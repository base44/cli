/**
 * HTTP client for OAuth endpoints.
 * Used only for the login flow (device code, token exchange).
 * These endpoints don't need Authorization headers - they use client_id + tokens in body.
 */

import ky from "ky";
import { getBase44ApiUrl } from "../config.js";

export const oauthClient = ky.create({
  prefixUrl: getBase44ApiUrl(),
  headers: {
    "User-Agent": "Base44 CLI",
  },
});
