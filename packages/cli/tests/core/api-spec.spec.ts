import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getOperationContract,
  getSpecCachePath,
  grepSpec,
  isSpecCacheFresh,
  listOperations,
  matchOperation,
  type OpenApiSpec,
  parseSpec,
  resolveRequestBody,
  SPEC_CACHE_TTL_MS,
  searchOperations,
} from "../../src/core/api-spec/index.js";
import { InvalidInputError } from "../../src/core/errors.js";

const FIXTURE = resolve(__dirname, "../fixtures/api-spec/openapi.json");

let spec: OpenApiSpec;
beforeAll(async () => {
  spec = parseSpec(await readFile(FIXTURE, "utf-8"));
});

const ops = () => listOperations(spec);
const find = (method: string, path: string) =>
  ops().find((op) => op.method === method && op.path === path);

describe("listOperations", () => {
  it("lists every method of every path, skipping path-level keys", () => {
    expect(ops()).toHaveLength(11);
    expect(
      find("GET", "/api/apps/{app_id}/workflows/{workflow_id}"),
    ).toBeDefined();
  });

  it("marks read-only from the personal access token requirement", () => {
    expect(find("GET", "/api/apps")?.readOnly).toBe(true);
    expect(find("POST", "/api/apps")?.readOnly).toBe(false);
    expect(find("POST", "/api/apps/{app_id}/deploy")?.readOnly).toBe(false);
    expect(find("GET", "/api/health")?.readOnly).toBe(false);
  });

  it("falls back to the spec-wide security when an operation lists none", () => {
    expect(find("GET", "/api/whoami")?.readOnly).toBe(false);
    const readOnlyByDefault = {
      ...spec,
      security: [{ PersonalAccessTokenAuth: ["read_only"] }],
    };
    const whoami = listOperations(readOnlyByDefault).find(
      (op) => op.path === "/api/whoami",
    );
    expect(whoami?.readOnly).toBe(true);
  });
});

describe("parseSpec", () => {
  it("rejects text that is not an OpenAPI document", () => {
    expect(() => parseSpec("not json")).toThrow("not valid JSON");
    expect(() => parseSpec('{"paths":{}}')).toThrow("Invalid API spec");
  });
});

describe("searchOperations", () => {
  it("ranks the operation whose path and summary match first", () => {
    const [top] = searchOperations(ops(), "workflow runs");
    expect(top).toEqual({
      method: "GET",
      path: "/api/apps/{app_id}/workflows/runs",
      summary: "List workflow runs for an app",
      readOnly: true,
    });
  });

  it("matches word prefixes and light typos", () => {
    expect(searchOperations(ops(), "secr")[0]?.path).toBe(
      "/api/apps/{app_id}/secrets",
    );
    expect(searchOperations(ops(), "secrts")[0]?.path).toBe(
      "/api/apps/{app_id}/secrets",
    );
  });

  it("finds an operation by a parameter description", () => {
    expect(searchOperations(ops(), "failed")[0]?.path).toBe(
      "/api/apps/{app_id}/workflows/runs",
    );
  });

  it("returns only read-only operations under readOnly", () => {
    const results = searchOperations(ops(), "workflow", { readOnly: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.readOnly)).toBe(true);
    expect(results.map((r) => r.summary)).not.toContain("Delete workflow");
  });

  it("drops results far below the best score", () => {
    const results = searchOperations(ops(), "secrets", { limit: 20 });
    expect(results.every((r) => r.path.includes("secrets"))).toBe(true);
  });

  it("returns at most limit results, 5 by default", () => {
    expect(
      searchOperations(ops(), "app", { limit: 20 }).length,
    ).toBeGreaterThan(5);
    expect(searchOperations(ops(), "app")).toHaveLength(5);
    expect(searchOperations(ops(), "app", { limit: 2 })).toHaveLength(2);
  });

  it("returns nothing for words the spec does not hold", () => {
    expect(searchOperations(ops(), "zebra")).toEqual([]);
  });
});

describe("matchOperation", () => {
  it("matches a concrete path to its template", () => {
    const op = matchOperation(ops(), "get", "/api/apps/68a1/workflows/wf_9");
    expect(op?.path).toBe("/api/apps/{app_id}/workflows/{workflow_id}");
    expect(op?.method).toBe("GET");
  });

  it("prefers a literal segment over a placeholder", () => {
    const op = matchOperation(ops(), "GET", "/api/apps/68a1/workflows/runs");
    expect(op?.path).toBe("/api/apps/{app_id}/workflows/runs");
  });

  it("ignores the query string and a trailing slash", () => {
    const op = matchOperation(
      ops(),
      "GET",
      "/api/apps/68a1/workflows/runs/?status=failed&since=2026-10-10",
    );
    expect(op?.path).toBe("/api/apps/{app_id}/workflows/runs");
  });

  it("matches the method too", () => {
    expect(
      matchOperation(ops(), "DELETE", "/api/apps/68a1/workflows/wf_9")
        ?.readOnly,
    ).toBe(false);
    expect(
      matchOperation(ops(), "PUT", "/api/apps/68a1/workflows/wf_9"),
    ).toBeUndefined();
  });

  it("returns undefined for a path the spec does not know", () => {
    expect(matchOperation(ops(), "GET", "/api/apps/68a1/nope")).toBeUndefined();
    expect(
      matchOperation(ops(), "GET", "/api/apps/68a1/workflows/a/b"),
    ).toBeUndefined();
  });
});

describe("getOperationContract", () => {
  it("returns the contract with every referenced schema, transitively", () => {
    const op = find("GET", "/api/apps");
    if (!op) throw new Error("fixture changed");
    const contract = getOperationContract(spec, op);
    expect(contract).toMatchObject({
      method: "GET",
      path: "/api/apps",
      readOnly: true,
      requestBody: null,
    });
    expect(Object.keys(contract.refs).sort()).toEqual([
      "#/components/schemas/App",
      "#/components/schemas/AppList",
    ]);
  });

  it("includes the request body schema", () => {
    const op = find("POST", "/api/apps/{app_id}/workflows");
    if (!op) throw new Error("fixture changed");
    const contract = getOperationContract(spec, op);
    expect(contract.requestBody).toBeTruthy();
    expect(contract.refs["#/components/schemas/WorkflowCreate"]).toMatchObject({
      properties: { trigger_status: { type: "string" } },
    });
  });
});

describe("grepSpec", () => {
  it("groups regex matches by operation and component schema", () => {
    const hits = grepSpec(spec, ops(), "trigger_\\w+");
    expect(hits).toEqual([
      {
        schema: "WorkflowCreate",
        matches: [expect.stringContaining("trigger_status")],
      },
    ]);
  });

  it("matches the method and path, case-insensitively when asked", () => {
    expect(grepSpec(spec, ops(), "DEPLOY AN APP")).toEqual([]);
    const hits = grepSpec(spec, ops(), "DEPLOY AN APP", { ignoreCase: true });
    expect(hits).toMatchObject([
      { method: "POST", path: "/api/apps/{app_id}/deploy", readOnly: false },
    ]);
  });
});

describe("resolveRequestBody", () => {
  const noStdin = {
    stdinIsTTY: true,
    readStdin: () => Promise.reject(new Error("stdin must not be read")),
  };
  const piped = (text: string) => ({
    stdinIsTTY: false,
    readStdin: () => Promise.resolve(text),
  });

  it("takes a JSON flag as is", async () => {
    expect(await resolveRequestBody("POST", '{"a":1}', noStdin)).toBe(
      '{"a":1}',
    );
  });

  it("reads @file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "api-body-"));
    const file = join(dir, "body.json");
    await writeFile(file, '{"from":"file"}\n');
    expect(await resolveRequestBody("PUT", `@${file}`, noStdin)).toBe(
      '{"from":"file"}\n',
    );
  });

  it("reads stdin for @-", async () => {
    expect(await resolveRequestBody("POST", "@-", piped('{"b":2}'))).toBe(
      '{"b":2}',
    );
  });

  it("reads piped stdin when no flag is given", async () => {
    expect(await resolveRequestBody("PATCH", undefined, piped('{"c":3}'))).toBe(
      '{"c":3}',
    );
  });

  it("sends no body for empty piped stdin or a terminal", async () => {
    expect(
      await resolveRequestBody("POST", undefined, piped("  \n")),
    ).toBeUndefined();
    expect(
      await resolveRequestBody("POST", undefined, noStdin),
    ).toBeUndefined();
  });

  it("never reads stdin for GET and rejects a GET body", async () => {
    const stdinThatThrows = { ...noStdin, stdinIsTTY: false };
    expect(
      await resolveRequestBody("GET", undefined, stdinThatThrows),
    ).toBeUndefined();
    await expect(resolveRequestBody("get", "{}", noStdin)).rejects.toThrow(
      InvalidInputError,
    );
  });
});

describe("spec cache", () => {
  it("keeps one cache file per server", () => {
    expect(getSpecCachePath("https://app.base44.com")).toBe(
      join(homedir(), ".base44", "cache", "app.base44.com", "openapi.json"),
    );
    expect(getSpecCachePath("http://localhost:8000/")).toBe(
      join(homedir(), ".base44", "cache", "localhost_8000", "openapi.json"),
    );
  });

  it("is fresh for one hour", () => {
    const now = 1_000_000_000;
    expect(isSpecCacheFresh(now - 1000, now)).toBe(true);
    expect(isSpecCacheFresh(now - SPEC_CACHE_TTL_MS + 1, now)).toBe(true);
    expect(isSpecCacheFresh(now - SPEC_CACHE_TTL_MS, now)).toBe(false);
  });
});
