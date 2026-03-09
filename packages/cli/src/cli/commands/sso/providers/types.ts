interface SSOCredentialsBase {
  ssoName: string;
  ssoClientId: string;
  ssoClientSecret: string;
  ssoScope: string;
}

export interface GoogleSSOCredentials extends SSOCredentialsBase {
  ssoDiscoveryUrl: string;
}

export interface MicrosoftSSOCredentials extends SSOCredentialsBase {
  ssoDiscoveryUrl: string;
  ssoTenantId: string;
}

export interface GitHubSSOCredentials extends SSOCredentialsBase {
  ssoAuthEndpoint: string;
  ssoTokenEndpoint: string;
  ssoUserinfoEndpoint: string;
}

export interface OktaSSOCredentials extends SSOCredentialsBase {
  ssoDiscoveryUrl: string;
  ssoOktaDomain: string;
}

export interface CustomSSOCredentials extends SSOCredentialsBase {
  ssoDiscoveryUrl?: string;
  ssoAuthEndpoint: string;
  ssoTokenEndpoint: string;
  ssoUserinfoEndpoint: string;
  ssoJwksUri: string;
}

export type SSOCredentials =
  | GoogleSSOCredentials
  | MicrosoftSSOCredentials
  | GitHubSSOCredentials
  | OktaSSOCredentials
  | CustomSSOCredentials;
