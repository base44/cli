import { InvalidInputError } from "@/core/errors.js";

const ACCESS_TOKEN_VAR = "BASE44_EXEC_ACCESS_TOKEN";
const SERVER_URL_VAR = "BASE44_EXEC_SERVER_URL";
const SERVICE_TOKEN_VAR = "BASE44_EXEC_SERVICE_TOKEN";

export const EXEC_ENV_VARS = [
  ACCESS_TOKEN_VAR,
  SERVER_URL_VAR,
  SERVICE_TOKEN_VAR,
] as const;

/** Env fallbacks for `--privileged` / `--data-env` (also the wrapper's own names); not part of the target. */
export const PRIVILEGED_ENV_VAR = "BASE44_PRIVILEGED";
export const DATA_ENV_ENV_VAR = "BASE44_DATA_ENV";

/**
 * An `exec` target supplied by the environment (e.g. a platform sandbox): the
 * SDK runs against `serverUrl` with `token`, with no platform login or lookup.
 */
interface ExecEnvTarget {
  serverUrl: string;
  token: string;
  serviceToken?: string;
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

const SDK_VERSION_VAR = "BASE44_EXEC_SDK_VERSION";
const SDK_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The SDK version a caller pre-cached for `exec` scripts, or `undefined` to use
 * the latest release. Not part of the target: it needs no credentials.
 */
export function readExecSdkVersion(env: Env = process.env): string | undefined {
  const version = read(env, SDK_VERSION_VAR);
  if (version && !SDK_VERSION_RE.test(version)) {
    throw new InvalidInputError(
      `${SDK_VERSION_VAR} must be an exact version such as 0.8.52.`,
    );
  }
  return version;
}

/** Whether any target variable is set, so `exec` skips the login. */
export function hasExecEnvTarget(env: Env = process.env): boolean {
  return EXEC_ENV_VARS.some((name) => read(env, name) !== undefined);
}

/**
 * Read the env-supplied `exec` target. Returns `undefined` when no target
 * variable is set. Error messages never include the values.
 */
export function readExecEnvTarget(
  env: Env = process.env,
): ExecEnvTarget | undefined {
  if (!hasExecEnvTarget(env)) {
    return undefined;
  }

  const token = read(env, ACCESS_TOKEN_VAR);
  const serverUrl = read(env, SERVER_URL_VAR);
  if (!token || !serverUrl) {
    const missing = token ? SERVER_URL_VAR : ACCESS_TOKEN_VAR;
    throw new InvalidInputError(
      `${missing} is not set. ${ACCESS_TOKEN_VAR} and ${SERVER_URL_VAR} must be set together.`,
      {
        hints: [
          {
            message: `Set both ${ACCESS_TOKEN_VAR} and ${SERVER_URL_VAR}, or unset all of them to use your login`,
          },
        ],
      },
    );
  }
  if (!URL.canParse(serverUrl)) {
    throw new InvalidInputError(`${SERVER_URL_VAR} is not a valid URL.`);
  }

  const serviceToken = read(env, SERVICE_TOKEN_VAR);
  return { token, serverUrl, ...(serviceToken ? { serviceToken } : {}) };
}
