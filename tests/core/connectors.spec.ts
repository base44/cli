import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../src/core/resources/connector/api.js";
import { readAllConnectors } from "../../src/core/resources/connector/config.js";
import {
  type OAuthFlowParams,
  runOAuthFlow,
} from "../../src/core/resources/connector/oauth.js";
import { pushConnectors } from "../../src/core/resources/connector/push.js";
import {
  type ConnectorResource,
  ConnectorResourceSchema,
  IntegrationTypeSchema,
} from "../../src/core/resources/connector/schema.js";

vi.mock("../../src/core/resources/connector/api.js");
vi.mock("open", () => ({ default: vi.fn() }));

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

describe("IntegrationTypeSchema", () => {
  it("accepts valid integration types", () => {
    const validTypes = [
      "googlecalendar",
      "googledrive",
      "gmail",
      "googlesheets",
      "googledocs",
      "googleslides",
      "slack",
      "notion",
      "salesforce",
      "hubspot",
      "linkedin",
      "tiktok",
    ];

    for (const type of validTypes) {
      expect(IntegrationTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects invalid integration types", () => {
    const invalidTypes = ["invalid", "google", "facebook", "twitter", ""];

    for (const type of invalidTypes) {
      expect(IntegrationTypeSchema.safeParse(type).success).toBe(false);
    }
  });
});

describe("ConnectorResourceSchema", () => {
  it("accepts valid connector with scopes", () => {
    const connector = {
      type: "googlecalendar",
      scopes: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
    };

    const result = ConnectorResourceSchema.safeParse(connector);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("googlecalendar");
      expect(result.data.scopes).toHaveLength(2);
    }
  });

  it("accepts valid connector with empty scopes", () => {
    const connector = {
      type: "notion",
      scopes: [],
    };

    const result = ConnectorResourceSchema.safeParse(connector);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scopes).toEqual([]);
    }
  });

  it("defaults scopes to empty array if not provided", () => {
    const connector = {
      type: "slack",
    };

    const result = ConnectorResourceSchema.safeParse(connector);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scopes).toEqual([]);
    }
  });

  it("rejects connector with invalid type", () => {
    const connector = {
      type: "invalid",
      scopes: [],
    };

    const result = ConnectorResourceSchema.safeParse(connector);
    expect(result.success).toBe(false);
  });

  it("rejects connector without type", () => {
    const connector = {
      scopes: [],
    };

    const result = ConnectorResourceSchema.safeParse(connector);
    expect(result.success).toBe(false);
  });
});

describe("readAllConnectors", () => {
  it("returns empty array for non-existent directory", async () => {
    const connectors = await readAllConnectors("/non/existent/path");
    expect(connectors).toEqual([]);
  });

  it("reads connectors from directory", async () => {
    const connectorsDir = resolve(FIXTURES_DIR, "with-connectors/connectors");
    const connectors = await readAllConnectors(connectorsDir);

    expect(connectors).toHaveLength(3);

    const types = connectors.map((c) => c.type).sort();
    expect(types).toEqual(["googlecalendar", "notion", "slack"]);

    const googleCalendar = connectors.find((c) => c.type === "googlecalendar");
    expect(googleCalendar?.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ]);

    const notion = connectors.find((c) => c.type === "notion");
    expect(notion?.scopes).toEqual([]);
  });

  it("throws error for invalid connector type", async () => {
    const connectorsDir = resolve(FIXTURES_DIR, "invalid-connector/connectors");

    await expect(readAllConnectors(connectorsDir)).rejects.toThrow(
      "Invalid connector file"
    );
  });
});

const mockListConnectors = vi.mocked(api.listConnectors);
const mockSetConnector = vi.mocked(api.setConnector);
const mockRemoveConnector = vi.mocked(api.removeConnector);

describe("pushConnectors", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListConnectors.mockResolvedValue({ integrations: [] });
  });

  it("returns empty results when no local or upstream connectors", async () => {
    const result = await pushConnectors([]);
    expect(result.results).toEqual([]);
    expect(mockListConnectors).toHaveBeenCalledOnce();
  });

  it("syncs local connectors", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ];
    mockSetConnector.mockResolvedValue({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });

    const result = await pushConnectors(local);

    expect(mockSetConnector).toHaveBeenCalledWith("gmail", [
      "https://mail.google.com/",
    ]);
    expect(result.results).toEqual([{ type: "gmail", action: "synced" }]);
  });

  it("removes upstream-only connectors", async () => {
    mockListConnectors.mockResolvedValue({
      integrations: [
        { integration_type: "slack", status: "ACTIVE", scopes: ["chat:write"] },
      ],
    });
    mockRemoveConnector.mockResolvedValue({
      status: "removed",
      integration_type: "slack",
    });

    const result = await pushConnectors([]);

    expect(mockRemoveConnector).toHaveBeenCalledWith("slack");
    expect(result.results).toEqual([{ type: "slack", action: "removed" }]);
  });

  it("syncs local and removes upstream-only", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ];
    mockListConnectors.mockResolvedValue({
      integrations: [
        { integration_type: "slack", status: "ACTIVE", scopes: ["chat:write"] },
      ],
    });
    mockSetConnector.mockResolvedValue({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });
    mockRemoveConnector.mockResolvedValue({
      status: "removed",
      integration_type: "slack",
    });

    const result = await pushConnectors(local);

    expect(mockSetConnector).toHaveBeenCalledWith("gmail", [
      "https://mail.google.com/",
    ]);
    expect(mockRemoveConnector).toHaveBeenCalledWith("slack");
    expect(result.results).toEqual([
      { type: "gmail", action: "synced" },
      { type: "slack", action: "removed" },
    ]);
  });

  it("does not remove connectors that exist locally", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ];
    mockListConnectors.mockResolvedValue({
      integrations: [
        {
          integration_type: "gmail",
          status: "ACTIVE",
          scopes: ["https://mail.google.com/"],
        },
      ],
    });
    mockSetConnector.mockResolvedValue({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });

    const result = await pushConnectors(local);

    expect(mockRemoveConnector).not.toHaveBeenCalled();
    expect(result.results).toEqual([{ type: "gmail", action: "synced" }]);
  });

  it("returns needs_oauth when redirect_url is present", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ];
    mockSetConnector.mockResolvedValue({
      redirect_url: "https://accounts.google.com/oauth",
      connection_id: "conn_123",
      already_authorized: false,
    });

    const result = await pushConnectors(local);

    expect(result.results).toEqual([
      {
        type: "gmail",
        action: "needs_oauth",
        redirectUrl: "https://accounts.google.com/oauth",
        connectionId: "conn_123",
      },
    ]);
  });

  it("returns error for different_user response", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ];
    mockSetConnector.mockResolvedValue({
      redirect_url: null,
      connection_id: null,
      already_authorized: false,
      error: "different_user",
      error_message: "Already connected by another user",
      other_user_email: "other@example.com",
    });

    const result = await pushConnectors(local);

    expect(result.results).toEqual([
      {
        type: "gmail",
        action: "error",
        error: "Already connected by another user",
      },
    ]);
  });

  it("handles sync errors gracefully", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ];
    mockSetConnector.mockRejectedValue(new Error("Network error"));

    const result = await pushConnectors(local);

    expect(result.results).toEqual([
      { type: "gmail", action: "error", error: "Network error" },
    ]);
  });

  it("handles remove errors gracefully", async () => {
    mockListConnectors.mockResolvedValue({
      integrations: [
        { integration_type: "slack", status: "ACTIVE", scopes: ["chat:write"] },
      ],
    });
    mockRemoveConnector.mockRejectedValue(new Error("Remove failed"));

    const result = await pushConnectors([]);

    expect(result.results).toEqual([
      { type: "slack", action: "error", error: "Remove failed" },
    ]);
  });

  it("processes multiple local connectors", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
      { type: "slack", scopes: ["chat:write"] },
    ];
    mockSetConnector.mockResolvedValue({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });

    const result = await pushConnectors(local);

    expect(mockSetConnector).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      { type: "gmail", action: "synced" },
      { type: "slack", action: "synced" },
    ]);
  });
});

const mockGetOAuthStatus = vi.mocked(api.getOAuthStatus);

describe("runOAuthFlow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ACTIVE when OAuth completes successfully", async () => {
    const params: OAuthFlowParams = {
      type: "gmail",
      redirectUrl: "https://accounts.google.com/oauth",
      connectionId: "conn_123",
    };
    mockGetOAuthStatus.mockResolvedValue({ status: "ACTIVE" });

    const result = await runOAuthFlow(params);

    expect(result).toEqual({ type: "gmail", status: "ACTIVE" });
    expect(mockGetOAuthStatus).toHaveBeenCalledWith("gmail", "conn_123");
  });

  it("returns FAILED when OAuth fails", async () => {
    const params: OAuthFlowParams = {
      type: "gmail",
      redirectUrl: "https://accounts.google.com/oauth",
      connectionId: "conn_123",
    };
    mockGetOAuthStatus.mockResolvedValue({ status: "FAILED" });

    const result = await runOAuthFlow(params);

    expect(result).toEqual({ type: "gmail", status: "FAILED" });
  });

  it("polls until status changes from PENDING", async () => {
    const params: OAuthFlowParams = {
      type: "gmail",
      redirectUrl: "https://accounts.google.com/oauth",
      connectionId: "conn_123",
    };
    mockGetOAuthStatus
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "ACTIVE" });

    const result = await runOAuthFlow(params);

    expect(result).toEqual({ type: "gmail", status: "ACTIVE" });
    expect(mockGetOAuthStatus).toHaveBeenCalledTimes(3);
  });
});
