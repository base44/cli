import type { KnownSSOProvider, SSOProviderSchema } from "../types.js";
import { customProvider } from "./custom.js";
import { githubProvider } from "./github.js";
import { googleProvider } from "./google.js";
import { microsoftProvider } from "./microsoft.js";
import { oktaProvider } from "./okta.js";

export const SSO_PROVIDER_SCHEMAS: Record<KnownSSOProvider, SSOProviderSchema> =
  {
    google: googleProvider,
    microsoft: microsoftProvider,
    github: githubProvider,
    okta: oktaProvider,
    custom: customProvider,
  };
