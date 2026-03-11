import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError } from "../../src/core/errors.js";
import * as api from "../../src/core/resources/connector/api.js";
import {
  readAllConnectors,
  writeConnectors,
} from "../../src/core/resources/connector/config.js";
import { pullAllConnectors } from "../../src/core/resources/connector/pull.js";
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

describe("writeConnectors", () => {
  it("writes remote connectors to files", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "connectors-test-"));

    try {
      const remoteConnectors = [
        {
          type: "gmail",
          scopes: ["https://mail.google.com/"],
        },
        {
          type: "slack",
          scopes: ["chat:write", "channels:read"],
        },
      ];

      const { written, deleted } = await writeConnectors(
        tmpDir,
        remoteConnectors,
      );

      expect(written).toEqual(["gmail", "slack"]);
      expect(deleted).toEqual([]);

      const connectors = await readAllConnectors(tmpDir);
      expect(connectors).toHaveLength(2);

      const gmail = connectors.find((c) => c.type === "gmail");
      expect(gmail?.scopes).toEqual(["https://mail.google.com/"]);

      const slack = connectors.find((c) => c.type === "slack");
      expect(slack?.scopes).toEqual(["chat:write", "channels:read"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes local connectors not in remote list", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "connectors-test-"));

    try {
      const initialConnectors = [
        {
          type: "gmail",
          scopes: ["https://mail.google.com/"],
        },
        {
          type: "slack",
          scopes: ["chat:write"],
        },
      ];
      await writeConnectors(tmpDir, initialConnectors);

      const { written, deleted } = await writeConnectors(tmpDir, [
        {
          type: "gmail",
          scopes: ["https://mail.google.com/"],
        },
      ]);

      expect(written).toEqual([]);
      expect(deleted).toEqual(["slack"]);

      const connectors = await readAllConnectors(tmpDir);
      expect(connectors).toHaveLength(1);
      expect(connectors[0].type).toBe("gmail");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles empty remote list by deleting all local connectors", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "connectors-test-"));

    try {
      const initialConnectors = [
        {
          type: "gmail",
          scopes: ["https://mail.google.com/"],
        },
      ];
      await writeConnectors(tmpDir, initialConnectors);

      const { written, deleted } = await writeConnectors(tmpDir, []);

      expect(written).toEqual([]);
      expect(deleted).toEqual(["gmail"]);

      const connectors = await readAllConnectors(tmpDir);
      expect(connectors).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes to existing file when type matches even if filename differs", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "connectors-test-"));

    try {
      await writeFile(
        join(tmpDir, "my-custom-slack.jsonc"),
        JSON.stringify({ type: "slack", scopes: ["chat:write"] }),
      );

      const remoteConnectors = [
        {
          type: "slack",
          scopes: ["chat:write", "channels:read"],
        },
      ];

      const { written, deleted } = await writeConnectors(
        tmpDir,
        remoteConnectors,
      );

      expect(written).toEqual(["slack"]);
      expect(deleted).toEqual([]);

      const files = await readdir(tmpDir);
      expect(files).toEqual(["my-custom-slack.jsonc"]);

      const content = JSON.parse(
        await readFile(join(tmpDir, "my-custom-slack.jsonc"), "utf-8"),
      );
      expect(content.scopes).toEqual(["chat:write", "channels:read"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes file with non-matching filename when type is not in remote", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "connectors-test-"));

    try {
      await writeFile(
        join(tmpDir, "my-slack.jsonc"),
        JSON.stringify({ type: "slack", scopes: ["chat:write"] }),
      );
      await writeFile(
        join(tmpDir, "email-connector.jsonc"),
        JSON.stringify({ type: "gmail", scopes: ["https://mail.google.com/"] }),
      );

      const remoteConnectors = [
        {
          type: "gmail",
          scopes: ["https://mail.google.com/"],
        },
      ];

      const { written, deleted } = await writeConnectors(
        tmpDir,
        remoteConnectors,
      );

      expect(written).toEqual([]);
      expect(deleted).toEqual(["slack"]);

      const files = (await readdir(tmpDir)).sort();
      expect(files).toEqual(["email-connector.jsonc"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips writing when data is unchanged, preserving comments and formatting", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "connectors-test-"));

    try {
      const fileContent = `// My Slack connector config\n{\n  "type": "slack",\n  "scopes": ["chat:write"]\n}\n`;
      await writeFile(join(tmpDir, "slack.jsonc"), fileContent);

      const remoteConnectors = [
        {
          type: "slack",
          scopes: ["chat:write"],
        },
      ];

      const { written, deleted } = await writeConnectors(
        tmpDir,
        remoteConnectors,
      );

      expect(written).toEqual([]);
      expect(deleted).toEqual([]);

      const rawContent = await readFile(join(tmpDir, "slack.jsonc"), "utf-8");
      expect(rawContent).toBe(fileContent);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates directory and writes files if directory doesn't exist", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "connectors-test-"));
    const connectorsDir = join(tmpDir, "connectors");

    try {
      const remoteConnectors = [
        {
          type: "notion",
          scopes: [] as string[],
        },
      ];

      const { written, deleted } = await writeConnectors(
        connectorsDir,
        remoteConnectors,
      );

      expect(written).toEqual(["notion"]);
      expect(deleted).toEqual([]);

      const connectors = await readAllConnectors(connectorsDir);
      expect(connectors).toHaveLength(1);
      expect(connectors[0].type).toBe("notion");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

const mockListConnectors = vi.mocked(api.listConnectors);
const mockSetConnector = vi.mocked(api.setConnector);
const mockRemoveConnector = vi.mocked(api.removeConnector);
const mockGetStripeStatus = vi.mocked(api.getStripeStatus);
const mockInstallStripe = vi.mocked(api.installStripe);
const mockRemoveStripe = vi.mocked(api.removeStripe);

describe("pushConnectors", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListConnectors.mockResolvedValue({ integrations: [] });
    mockGetStripeStatus.mockResolvedValue({
      stripeMode: null,
      sandboxClaimUrl: null,
    });
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

  describe("stripe", () => {
    it("installs Stripe when local exists and remote is not installed", async () => {
      const local: ConnectorResource[] = [{ type: "stripe", scopes: [] }];
      mockInstallStripe.mockResolvedValue({
        alreadyInstalled: false,
        claimUrl: null,
      });

      const result = await pushConnectors(local);

      expect(mockInstallStripe).toHaveBeenCalledOnce();
      expect(result.results).toEqual([
        { type: "stripe", action: "provisioned" },
      ]);
    });

    it("returns provisioned with claimUrl when Stripe install provides one", async () => {
      const local: ConnectorResource[] = [{ type: "stripe", scopes: [] }];
      mockInstallStripe.mockResolvedValue({
        alreadyInstalled: false,
        claimUrl: "https://connect.stripe.com/setup/claim/xxx",
      });

      const result = await pushConnectors(local);

      expect(result.results).toEqual([
        {
          type: "stripe",
          action: "provisioned",
          claimUrl: "https://connect.stripe.com/setup/claim/xxx",
        },
      ]);
    });

    it("returns synced when local Stripe exists and remote is already installed", async () => {
      const local: ConnectorResource[] = [{ type: "stripe", scopes: [] }];
      mockGetStripeStatus.mockResolvedValue({
        stripeMode: "sandbox",
        sandboxClaimUrl: null,
      });

      const result = await pushConnectors(local);

      expect(mockInstallStripe).not.toHaveBeenCalled();
      expect(result.results).toEqual([{ type: "stripe", action: "synced" }]);
    });

    it("removes Stripe when no local Stripe but remote is installed", async () => {
      mockGetStripeStatus.mockResolvedValue({
        stripeMode: "sandbox",
        sandboxClaimUrl: null,
      });
      mockRemoveStripe.mockResolvedValue({ success: true });

      const result = await pushConnectors([]);

      expect(mockRemoveStripe).toHaveBeenCalledOnce();
      expect(result.results).toEqual([{ type: "stripe", action: "removed" }]);
    });

    it("returns error when Stripe install fails", async () => {
      const local: ConnectorResource[] = [{ type: "stripe", scopes: [] }];
      mockInstallStripe.mockRejectedValue(new Error("Stripe install timeout"));

      const result = await pushConnectors(local);

      expect(result.results).toEqual([
        { type: "stripe", action: "error", error: "Stripe install timeout" },
      ]);
    });

    it("returns error when Stripe removal fails", async () => {
      mockGetStripeStatus.mockResolvedValue({
        stripeMode: "live",
        sandboxClaimUrl: null,
      });
      mockRemoveStripe.mockRejectedValue(new Error("Stripe remove failed"));

      const result = await pushConnectors([]);

      expect(result.results).toEqual([
        { type: "stripe", action: "error", error: "Stripe remove failed" },
      ]);
    });

    it("returns error when getStripeStatus fails and local Stripe exists", async () => {
      const local: ConnectorResource[] = [{ type: "stripe", scopes: [] }];
      mockGetStripeStatus.mockRejectedValue(new Error("Status check failed"));

      const result = await pushConnectors(local);

      expect(result.results).toEqual([
        {
          type: "stripe",
          action: "error",
          error: "Failed to check Stripe integration status",
        },
      ]);
    });

    it("returns no Stripe result when getStripeStatus fails and no local Stripe", async () => {
      mockGetStripeStatus.mockRejectedValue(new Error("Status check failed"));

      const result = await pushConnectors([]);

      expect(result.results).toEqual([]);
    });

    it("returns no Stripe result when no local and no remote Stripe", async () => {
      const result = await pushConnectors([]);

      expect(mockInstallStripe).not.toHaveBeenCalled();
      expect(mockRemoveStripe).not.toHaveBeenCalled();
      expect(result.results).toEqual([]);
    });

    it("handles OAuth and Stripe connectors together", async () => {
      const local: ConnectorResource[] = [
        { type: "gmail", scopes: ["https://mail.google.com/"] },
        { type: "stripe", scopes: [] },
      ];
      mockSetConnector.mockResolvedValue({
        redirectUrl: null,
        connectionId: null,
        alreadyAuthorized: true,
        error: null,
        errorMessage: null,
        otherUserEmail: null,
      });
      mockInstallStripe.mockResolvedValue({
        alreadyInstalled: false,
        claimUrl: "https://connect.stripe.com/setup/claim/xxx",
      });

      const result = await pushConnectors(local);

      expect(mockSetConnector).toHaveBeenCalledWith("gmail", [
        "https://mail.google.com/",
      ]);
      expect(mockInstallStripe).toHaveBeenCalledOnce();
      expect(result.results).toEqual([
        { type: "gmail", action: "synced" },
        {
          type: "stripe",
          action: "provisioned",
          claimUrl: "https://connect.stripe.com/setup/claim/xxx",
        },
      ]);
    });
  });
});

describe("pullAllConnectors", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns only OAuth connectors when Stripe is not installed", async () => {
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
    mockGetStripeStatus.mockResolvedValue({
      stripeMode: null,
      sandboxClaimUrl: null,
    });

    const result = await pullAllConnectors();

    expect(result).toEqual([
      { type: "gmail", scopes: ["https://mail.google.com/"] },
    ]);
  });

  it("includes Stripe connector when remote has Stripe installed", async () => {
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
    mockGetStripeStatus.mockResolvedValue({
      stripeMode: "sandbox",
      sandboxClaimUrl: null,
    });

    const result = await pullAllConnectors();

    expect(result).toEqual([
      { type: "slack", scopes: ["chat:write"] },
      { type: "stripe", scopes: [] },
    ]);
  });

  it("returns only Stripe when no OAuth connectors exist", async () => {
    mockListConnectors.mockResolvedValue({ integrations: [] });
    mockGetStripeStatus.mockResolvedValue({
      stripeMode: "live",
      sandboxClaimUrl: null,
    });

    const result = await pullAllConnectors();

    expect(result).toEqual([{ type: "stripe", scopes: [] }]);
  });

  it("returns empty array when no connectors exist remotely", async () => {
    mockListConnectors.mockResolvedValue({ integrations: [] });
    mockGetStripeStatus.mockResolvedValue({
      stripeMode: null,
      sandboxClaimUrl: null,
    });

    const result = await pullAllConnectors();

    expect(result).toEqual([]);
  });

  it("throws when getStripeStatus fails", async () => {
    mockListConnectors.mockResolvedValue({ integrations: [] });
    mockGetStripeStatus.mockRejectedValue(new Error("Stripe API error"));

    await expect(pullAllConnectors()).rejects.toThrow("Stripe API error");
  });

  it("throws when listConnectors fails", async () => {
    mockListConnectors.mockRejectedValue(new Error("List API error"));
    mockGetStripeStatus.mockResolvedValue({
      stripeMode: null,
      sandboxClaimUrl: null,
    });

    await expect(pullAllConnectors()).rejects.toThrow("List API error");
  });
});
