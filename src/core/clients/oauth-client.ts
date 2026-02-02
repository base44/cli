/**
 * HTTP client for OAuth endpoints.
 * Used only for the login flow (device code, token exchange).
 * These endpoints don't need Authorization headers - they use client_id + tokens in body.
 */

import { getBase44ApiUrl } from "@/core/config.js";
import ky from "ky";

export const oauthClient = ky.create({
  prefixUrl: getBase44ApiUrl(),
  headers: {
    "User-Agent": "Base44 CLI",
  },
});
