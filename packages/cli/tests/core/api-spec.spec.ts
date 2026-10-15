import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  areaListing,
  areaOf,
  catalogIndex,
  getOperationContract,
  getSpecCachePath,
  grepOperations,
  groupByArea,
  isSpecCacheFresh,
  listOperations,
  matchOperation,
  type OpenApiSpec,
  parseSpec,
  SPEC_CACHE_TTL_MS,
  searchOperations,
} from "../../src/core/api-spec/index.js";

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
      endpoint: "GET /api/apps/{app_id}/workflows/runs",
      summary: "List workflow runs for an app",
    });
  });

  it("matches word prefixes and light typos", () => {
    expect(searchOperations(ops(), "secr")[0]?.endpoint).toContain(
      "/api/apps/{app_id}/secrets",
    );
    expect(searchOperations(ops(), "secrts")[0]?.endpoint).toContain(
      "/api/apps/{app_id}/secrets",
    );
  });

  it("finds an operation by a parameter description", () => {
    expect(searchOperations(ops(), "failed")[0]?.endpoint).toBe(
      "GET /api/apps/{app_id}/workflows/runs",
    );
  });

  it("returns only read-only operations under readOnly", () => {
    const results = searchOperations(ops(), "workflow", { readOnly: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.endpoint.startsWith("GET "))).toBe(true);
    expect(results.map((r) => r.summary)).not.toContain("Delete workflow");
  });

  it("drops results far below the best score", () => {
    const results = searchOperations(ops(), "secrets", { limit: 20 });
    expect(results.every((r) => r.endpoint.includes("secrets"))).toBe(true);
  });

  it("returns at most limit results, 5 by default", () => {
    expect(
      searchOperations(ops(), "api", { limit: 20 }).length,
    ).toBeGreaterThan(5);
    expect(searchOperations(ops(), "api")).toHaveLength(5);
    expect(searchOperations(ops(), "api", { limit: 2 })).toHaveLength(2);
  });

  it("drops filler words, so a question of them finds nothing", () => {
    expect(searchOperations(ops(), "who am i")).toEqual([]);
    expect(searchOperations(ops(), "list my apps")[0]?.endpoint).toBe(
      "GET /api/apps",
    );
  });

  it("ranks the operation whose summary holds the query", () => {
    expect(searchOperations(ops(), "deploy app")[0]?.endpoint).toBe(
      "POST /api/apps/{app_id}/deploy",
    );
  });

  it("puts the summary that names the query exactly first", () => {
    expect(searchOperations(ops(), "get workflow")[0]).toEqual({
      endpoint: "GET /api/apps/{app_id}/workflows/{workflow_id}",
      summary: "Get workflow",
    });
  });

  it("puts reads first among equally exact summaries", () => {
    expect(searchOperations(ops(), "workflow")[0]?.endpoint).toBe(
      "GET /api/apps/{app_id}/workflows/{workflow_id}",
    );
  });

  it("ignores one-letter words and id", () => {
    expect(searchOperations(ops(), "x")).toEqual([]);
    expect(searchOperations(ops(), "id")).toEqual([]);
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
  const contractOf = (method: string, path: string) => {
    const op = find(method, path);
    if (!op) throw new Error("fixture changed");
    return getOperationContract(spec, op);
  };

  it("includes path-level parameters shared by every method", () => {
    const names = (method: string) =>
      contractOf(
        method,
        "/api/apps/{app_id}/workflows/{workflow_id}",
      ).parameters.map((p) => `${p.in}:${p.name}`);
    expect(names("GET")).toEqual([
      "header:x-request-source",
      "path:app_id",
      "path:workflow_id",
    ]);
    expect(names("DELETE")).toContain("header:x-request-source");
  });

  it("names a body that is not JSON, with its schema", () => {
    expect(contractOf("POST", "/api/apps")).toMatchObject({
      requestBodyContentType: "multipart/form-data",
      requestBodySchema: { properties: { file: { format: "binary" } } },
    });
  });

  it("lists every schema still referenced after inlining", () => {
    expect(Object.keys(contractOf("GET", "/api/apps").refs ?? {})).toEqual([
      "#/components/schemas/App",
    ]);
    expect(contractOf("GET", "/api/apps/{app_id}/secrets")).not.toHaveProperty(
      "refs",
    );
  });

  it("keeps the success response schema with its refs inlined", () => {
    const contract = contractOf("GET", "/api/apps");
    expect(contract).toMatchObject({
      endpoint: "GET /api/apps",
      method: "GET",
      path: "/api/apps",
      summary: "List apps",
      parameters: [],
      requestBodySchema: null,
    });
    expect(contract.responseSchema).toMatchObject({
      properties: {
        apps: { items: { properties: { id: { type: "string" } } } },
      },
    });
  });

  it("stops at a cycle and lets keys beside a $ref win", () => {
    const parent = (
      contractOf("GET", "/api/apps").responseSchema as {
        properties: { apps: { items: { properties: { parent: unknown } } } };
      }
    ).properties.apps.items.properties.parent;
    expect(parent).toEqual({
      $ref: "#/components/schemas/App",
      description: "The app this one was remixed from.",
    });
  });

  it("drops FastAPI's generated titles but keeps a field named title", () => {
    const body = contractOf("POST", "/api/apps/{app_id}/workflows")
      .requestBodySchema as Record<string, unknown>;
    expect(body).not.toHaveProperty("title");
    expect(body.properties).toMatchObject({
      title: { type: "string", description: "Shown in the workflow list." },
    });
    expect(JSON.stringify(body)).not.toContain('"title":"Title"');
  });

  it("writes anyOf with null as a nullable type", () => {
    const status = contractOf(
      "GET",
      "/api/apps/{app_id}/workflows/runs",
    ).parameters.find((p) => p.name === "status");
    expect(status?.schema).toEqual({ type: ["string", "null"] });
  });

  it("strips docs callout tags and keeps their text", () => {
    const { description } = contractOf(
      "GET",
      "/api/apps/{app_id}/workflows/{workflow_id}",
    );
    expect(description).not.toMatch(/<\/?(Info|Warning)>/);
    expect(description).toContain("This endpoint is in beta.");
    expect(description).toContain(
      "Warning: Archived workflows are not returned.",
    );
  });

  it("turns relative docs links into their text", () => {
    const { description } = contractOf(
      "GET",
      "/api/apps/{app_id}/workflows/{workflow_id}",
    );
    expect(description).toContain("Start it with Run a workflow now.");
    expect(description).not.toContain("](/");
  });

  it("leaves error responses out, as the MCP bridge does", () => {
    expect(contractOf("GET", "/api/apps")).not.toHaveProperty("errors");
  });

  it("returns the request body schema and trimmed parameters", () => {
    const contract = contractOf("GET", "/api/apps/{app_id}/workflows/runs");
    expect(contract.parameters).toEqual([
      {
        name: "app_id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: ["string", "null"] },
        description: "Keep only runs in this state, for example `failed`.",
      },
    ]);
    expect(
      contractOf("POST", "/api/apps/{app_id}/workflows").requestBodySchema,
    ).toMatchObject({ properties: { trigger_status: { type: "string" } } });
  });
});

describe("grepOperations", () => {
  it("finds the operation whose inlined schema holds the field", () => {
    expect(grepOperations(spec, ops(), "trigger_\\w+")).toEqual([
      {
        endpoint: "POST /api/apps/{app_id}/workflows",
        summary: "Create workflow",
      },
    ]);
  });

  it("searches only the operations given", () => {
    const workflows = ops().filter((op) => op.path.includes("/workflows"));
    expect(grepOperations(spec, workflows, "workflow")).toHaveLength(4);
  });

  it("does not search the generated operationId", () => {
    expect(grepOperations(spec, ops(), "list_app_runs")).toEqual([]);
  });

  it("matches the endpoint, case-insensitively when asked", () => {
    expect(grepOperations(spec, ops(), "DEPLOY AN APP")).toEqual([]);
    expect(
      grepOperations(spec, ops(), "DEPLOY AN APP", { ignoreCase: true }),
    ).toEqual([
      { endpoint: "POST /api/apps/{app_id}/deploy", summary: "Deploy an app" },
    ]);
  });
});

describe("catalog", () => {
  it("caps one area's listing and says when it is truncated", () => {
    const workflows = groupByArea(ops()).get("workflows") ?? [];
    expect(areaListing("workflows", workflows)).toMatchObject({
      total: 4,
      truncated: false,
    });
    const capped = areaListing("workflows", workflows, 3);
    expect(capped.operations).toHaveLength(3);
    expect(capped).toMatchObject({ total: 4, truncated: true });
  });

  it("names the area after {app_id}, else after /api", () => {
    expect(areaOf("/api/apps/{app_id}/deploy")).toBe("deploy");
    expect(areaOf("/api/apps/{app_id}/workflows/{workflow_id}")).toBe(
      "workflows",
    );
    expect(areaOf("/api/apps/{app_id}")).toBe("apps");
    expect(areaOf("/api/apps")).toBe("apps");
    expect(areaOf("/api/workspace/{workspace_id}/connectors")).toBe(
      "workspace",
    );
    expect(areaOf("/health")).toBe("health");
    expect(areaOf("/")).toBe("other");
  });

  it("sorts areas and their operations", () => {
    const areas = groupByArea(ops());
    expect([...areas.keys()]).toEqual([
      "apps",
      "deploy",
      "health",
      "secrets",
      "whoami",
      "workflows",
    ]);
    expect(
      areas.get("workflows")?.map((op) => `${op.method} ${op.path}`),
    ).toEqual([
      "DELETE /api/apps/{app_id}/workflows/{workflow_id}",
      "GET /api/apps/{app_id}/workflows/runs",
      "GET /api/apps/{app_id}/workflows/{workflow_id}",
      "POST /api/apps/{app_id}/workflows",
    ]);
  });

  it("lists small areas in full and collapses the rest", () => {
    const { areas, total } = catalogIndex(ops());
    expect(total).toBe(11);
    expect(areas.find((a) => a.area === "secrets")).toEqual({
      area: "secrets",
      operations: [
        { endpoint: "GET /api/apps/{app_id}/secrets", summary: "List secrets" },
        { endpoint: "POST /api/apps/{app_id}/secrets", summary: "Set secret" },
      ],
    });
    expect(areas.find((a) => a.area === "workflows")).toEqual({
      area: "workflows",
      operationCount: 4,
      sample: [
        "List workflow runs for an app",
        "Get workflow",
        "Delete workflow",
      ],
    });
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
