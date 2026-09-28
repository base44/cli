import { z } from "zod";
import { InvalidInputError } from "@/core/errors.js";

const ACCESS_TOKEN_VAR = "BASE44_EXEC_ACCESS_TOKEN";
const SERVER_URL_VAR = "BASE44_EXEC_SERVER_URL";
const SERVICE_TOKEN_VAR = "BASE44_EXEC_SERVICE_TOKEN";
const HEADERS_VAR = "BASE44_EXEC_HEADERS";

export const EXEC_ENV_VARS = [
  ACCESS_TOKEN_VAR,
  SERVER_URL_VAR,
  SERVICE_TOKEN_VAR,
  HEADERS_VAR,
] as const;

/**
 * An `exec` target supplied by the environment (e.g. a platform sandbox): the
 * SDK runs against `serverUrl` with `token`, with no platform login or lookup.
 */
interface ExecEnvTarget {
  serverUrl: string;
  token: string;
  serviceToken?: string;
  headers?: Record<string, string>;
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

/** Whether any `BASE44_EXEC_*` variable is set, so `exec` skips the login. */
export function hasExecEnvTarget(env: Env = process.env): boolean {
  return EXEC_ENV_VARS.some((name) => read(env, name) !== undefined);
}

const HeadersSchema = z.record(z.string(), z.string());

function parseHeaders(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidInputError(`${HEADERS_VAR} is not valid JSON.`, {
      hints: [{ message: `Set ${HEADERS_VAR} to e.g. '{"X-Header":"value"}'` }],
    });
  }
  const result = HeadersSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidInputError(
      `${HEADERS_VAR} must be a JSON object of string header values.`,
      {
        hints: [
          { message: `Set ${HEADERS_VAR} to e.g. '{"X-Header":"value"}'` },
        ],
      },
    );
  }
  return result.data;
}

/**
 * Read the env-supplied `exec` target. Returns `undefined` when no
 * `BASE44_EXEC_*` variable is set. Error messages never include the values.
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
            message: `Set both ${ACCESS_TOKEN_VAR} and ${SERVER_URL_VAR}, or unset all BASE44_EXEC_* variables to use your login`,
          },
        ],
      },
    );
  }
  if (!URL.canParse(serverUrl)) {
    throw new InvalidInputError(`${SERVER_URL_VAR} is not a valid URL.`);
  }

  const serviceToken = read(env, SERVICE_TOKEN_VAR);
  const rawHeaders = read(env, HEADERS_VAR);
  return {
    token,
    serverUrl,
    ...(serviceToken ? { serviceToken } : {}),
    ...(rawHeaders ? { headers: parseHeaders(rawHeaders) } : {}),
  };
}
