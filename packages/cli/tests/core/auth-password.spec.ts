import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock project config
vi.mock("../../src/core/project/index.js", () => ({
  getAppConfig: () => ({ id: "test-app-id" }),
  initAppConfig: () => ({ id: "test-app-id" }),
}));

// Mock HTTP client
const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock("../../src/core/clients/index.js", () => ({
  base44Client: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}));

import { pushAuthConfigToApi } from "../../src/core/resources/auth-config/api.js";
import {
  readAuthConfig,
  writeAuthConfig,
} from "../../src/core/resources/auth-config/config.js";
import { pullAuthConfig } from "../../src/core/resources/auth-config/pull.js";
import { pushAuthConfig } from "../../src/core/resources/auth-config/push.js";
import {
  type AuthConfig,
  hasAnyLoginMethod,
} from "../../src/core/resources/auth-config/schema.js";

const DEFAULT_API_AUTH_CONFIG = {
  enable_username_password: true,
  enable_google_login: false,
  enable_microsoft_login: false,
  enable_facebook_login: false,
  enable_apple_login: false,
  sso_provider_name: null,
  enable_sso_login: false,
  google_oauth_mode: "default",
  google_oauth_client_id: null,
  use_workspace_sso: false,
};

function mockAppResponse(overrides: Record<string, unknown> = {}) {
  return {
    json: () =>
      Promise.resolve({
        auth_config: { ...DEFAULT_API_AUTH_CONFIG, ...overrides },
      }),
  };
}

const ALL_DISABLED: AuthConfig = {
  enableUsernamePassword: false,
  enableGoogleLogin: false,
  enableMicrosoftLogin: false,
  enableFacebookLogin: false,
  enableAppleLogin: false,
  ssoProviderName: null,
  enableSSOLogin: false,
  googleOAuthMode: "default",
  googleOAuthClientId: null,
  useWorkspaceSSO: false,
};

describe("pushAuthConfigToApi", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends the full config as snake_case payload", async () => {
    const config: AuthConfig = {
      ...ALL_DISABLED,
      enableUsernamePassword: true,
    };
    mockPut.mockResolvedValue(
      mockAppResponse({ enable_username_password: true }),
    );

    const result = await pushAuthConfigToApi(config);

    expect(result.enableUsernamePassword).toBe(true);
    const putCall = mockPut.mock.calls[0];
    const payload = putCall[1].json.auth_config;
    expect(payload.enable_username_password).toBe(true);
  });

  it("returns parsed AuthConfig from response", async () => {
    const config: AuthConfig = {
      ...ALL_DISABLED,
      enableUsernamePassword: true,
    };
    mockPut.mockResolvedValue(
      mockAppResponse({
        enable_username_password: true,
        enable_google_login: true,
      }),
    );

    const result = await pushAuthConfigToApi(config);

    expect(result.enableUsernamePassword).toBe(true);
    expect(result.enableGoogleLogin).toBe(true);
    expect(result.ssoProviderName).toBeNull();
  });

  it("throws on HTTP failure", async () => {
    const config: AuthConfig = { ...ALL_DISABLED };
    mockPut.mockRejectedValue(new Error("Server error"));

    await expect(pushAuthConfigToApi(config)).rejects.toThrow();
  });
});

describe("hasAnyLoginMethod", () => {
  it("returns true when only password is enabled", () => {
    expect(
      hasAnyLoginMethod({ ...ALL_DISABLED, enableUsernamePassword: true }),
    ).toBe(true);
  });

  it("returns true when only a social provider is enabled", () => {
    expect(
      hasAnyLoginMethod({ ...ALL_DISABLED, enableGoogleLogin: true }),
    ).toBe(true);
  });

  it("returns true when only SSO is enabled", () => {
    expect(hasAnyLoginMethod({ ...ALL_DISABLED, enableSSOLogin: true })).toBe(
      true,
    );
  });

  it("returns false when all methods are disabled", () => {
    expect(hasAnyLoginMethod(ALL_DISABLED)).toBe(false);
  });
});

describe("readAuthConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "auth-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", async () => {
    const result = await readAuthConfig(tempDir);
    expect(result).toBeNull();
  });

  it("returns config when file exists with valid content", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(tempDir, "config.jsonc"),
      JSON.stringify(ALL_DISABLED),
    );

    const result = await readAuthConfig(tempDir);
    expect(result).toEqual(ALL_DISABLED);
  });

  it("throws on invalid file content", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(tempDir, "config.jsonc"),
      JSON.stringify({ invalid: true }),
    );

    await expect(readAuthConfig(tempDir)).rejects.toThrow();
  });
});

describe("writeAuthConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "auth-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes config file and returns written: true", async () => {
    const result = await writeAuthConfig(tempDir, ALL_DISABLED);
    expect(result.written).toBe(true);

    const config = await readAuthConfig(tempDir);
    expect(config).toEqual(ALL_DISABLED);
  });

  it("skips write when content is unchanged", async () => {
    await writeAuthConfig(tempDir, ALL_DISABLED);
    const result = await writeAuthConfig(tempDir, ALL_DISABLED);
    expect(result.written).toBe(false);
  });

  it("writes when content has changed", async () => {
    await writeAuthConfig(tempDir, ALL_DISABLED);
    const updated = { ...ALL_DISABLED, enableUsernamePassword: true };
    const result = await writeAuthConfig(tempDir, updated);
    expect(result.written).toBe(true);

    const config = await readAuthConfig(tempDir);
    expect(config?.enableUsernamePassword).toBe(true);
  });
});

describe("pullAuthConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches auth config from API", async () => {
    mockGet.mockResolvedValue(mockAppResponse());

    const result = await pullAuthConfig();

    expect(result.enableUsernamePassword).toBe(true);
    expect(mockGet).toHaveBeenCalledWith("api/apps/test-app-id");
  });
});

describe("pushAuthConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when config is null", async () => {
    await pushAuthConfig(null);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("pushes config to API when config is provided", async () => {
    const config: AuthConfig = {
      ...ALL_DISABLED,
      enableUsernamePassword: true,
    };
    mockPut.mockResolvedValue(
      mockAppResponse({ enable_username_password: true }),
    );

    await pushAuthConfig(config);

    expect(mockPut).toHaveBeenCalledTimes(1);
  });
});
