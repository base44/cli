import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError } from "../../src/core/errors.js";
import * as api from "../../src/core/resources/connector/api.js";
import { readAllConnectors } from "../../src/core/resources/connector/config.js";
import { pushConnectors } from "../../src/core/resources/connector/push.js";
import type { ConnectorResource } from "../../src/core/resources/connector/schema.js";

vi.mock("../../src/core/resources/connector/api.js");

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

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
      "Invalid connector file",
    );
  });

  it("throws InvalidInputError for duplicate connector types", async () => {
    const connectorsDir = resolve(
      FIXTURES_DIR,
      "duplicate-connectors/connectors",
    );

    await expect(readAllConnectors(connectorsDir)).rejects.toThrow(
      InvalidInputError,
    );
    await expect(readAllConnectors(connectorsDir)).rejects.toThrow(
      'Duplicate connector type "slack"',
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
      redirectUrl: null,
      connectionId: null,
      alreadyAuthorized: true,
      error: null,
      errorMessage: null,
      otherUserEmail: null,
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
        {
          integrationType: "slack",
          status: "active",
          scopes: ["chat:write"],
          userEmail: undefined,
        },
      ],
    });
    mockRemoveConnector.mockResolvedValue({
      status: "removed",
      integrationType: "slack",
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
        {
          integrationType: "slack",
          status: "active",
          scopes: ["chat:write"],
          userEmail: undefined,
        },
      ],
    });
    mockSetConnector.mockResolvedValue({
      redirectUrl: null,
      connectionId: null,
      alreadyAuthorized: true,
      error: null,
      errorMessage: null,
      otherUserEmail: null,
    });
    mockRemoveConnector.mockResolvedValue({
      status: "removed",
      integrationType: "slack",
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
          integrationType: "gmail",
          status: "active",
          scopes: ["https://mail.google.com/"],
          userEmail: undefined,
        },
      ],
    });
    mockSetConnector.mockResolvedValue({
      redirectUrl: null,
      connectionId: null,
      alreadyAuthorized: true,
      error: null,
      errorMessage: null,
      otherUserEmail: null,
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
      redirectUrl: "https://accounts.google.com/oauth",
      connectionId: "conn_123",
      alreadyAuthorized: false,
      error: null,
      errorMessage: null,
      otherUserEmail: null,
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
      redirectUrl: null,
      connectionId: null,
      alreadyAuthorized: false,
      error: "different_user",
      errorMessage: "Already connected by another user",
      otherUserEmail: "other@example.com",
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

  it("returns fallback message when different_user has no error_message or email", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ];
    mockSetConnector.mockResolvedValue({
      redirectUrl: null,
      connectionId: null,
      alreadyAuthorized: false,
      error: "different_user",
      errorMessage: null,
      otherUserEmail: null,
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
        {
          integrationType: "slack",
          status: "active",
          scopes: ["chat:write"],
          userEmail: undefined,
        },
      ],
    });
    mockRemoveConnector.mockRejectedValue(new Error("Remove failed"));

    const result = await pushConnectors([]);

    expect(result.results).toEqual([
      { type: "slack", action: "error", error: "Remove failed" },
    ]);
  });

  it("syncs a custom (unknown) integration type", async () => {
    const local: ConnectorResource[] = [
      { type: "custom-crm", scopes: ["read", "write"] },
    ];
    mockSetConnector.mockResolvedValue({
      redirectUrl: null,
      connectionId: null,
      alreadyAuthorized: true,
      error: null,
      errorMessage: null,
      otherUserEmail: null,
    });

    const result = await pushConnectors(local);

    expect(mockSetConnector).toHaveBeenCalledWith("custom-crm", [
      "read",
      "write",
    ]);
    expect(result.results).toEqual([{ type: "custom-crm", action: "synced" }]);
  });

  it("removes an upstream custom (unknown) integration type not present locally", async () => {
    mockListConnectors.mockResolvedValue({
      integrations: [
        {
          integrationType: "custom-crm",
          status: "active",
          scopes: ["read"],
          userEmail: undefined,
        },
      ],
    });
    mockRemoveConnector.mockResolvedValue({
      status: "removed",
      integrationType: "custom-crm",
    });

    const result = await pushConnectors([]);

    expect(mockRemoveConnector).toHaveBeenCalledWith("custom-crm");
    expect(result.results).toEqual([{ type: "custom-crm", action: "removed" }]);
  });

  it("processes multiple local connectors", async () => {
    const local: ConnectorResource[] = [
      { type: "gmail", scopes: ["https://mail.google.com/"] },
      { type: "slack", scopes: ["chat:write"] },
    ];
    mockSetConnector.mockResolvedValue({
      redirectUrl: null,
      connectionId: null,
      alreadyAuthorized: true,
      error: null,
      errorMessage: null,
      otherUserEmail: null,
    });

    const result = await pushConnectors(local);

    expect(mockSetConnector).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      { type: "gmail", action: "synced" },
      { type: "slack", action: "synced" },
    ]);
  });
});
