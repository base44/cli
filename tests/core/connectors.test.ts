import { describe, it, expect } from "vitest";
import {
  SUPPORTED_INTEGRATIONS,
  INTEGRATION_DISPLAY_NAMES,
  isValidIntegration,
  getIntegrationDisplayName,
} from "../../src/core/connectors/constants.js";
import {
  InitiateResponseSchema,
  StatusResponseSchema,
  ConnectorSchema,
  ListResponseSchema,
  ApiErrorSchema,
} from "../../src/core/connectors/schema.js";

describe("connectors/constants", () => {
  describe("SUPPORTED_INTEGRATIONS", () => {
    it("contains expected integrations", () => {
      expect(SUPPORTED_INTEGRATIONS).toContain("slack");
      expect(SUPPORTED_INTEGRATIONS).toContain("notion");
      expect(SUPPORTED_INTEGRATIONS).toContain("googlecalendar");
      expect(SUPPORTED_INTEGRATIONS).toContain("googledrive");
      expect(SUPPORTED_INTEGRATIONS).toContain("gmail");
    });

    it("has display names for all integrations", () => {
      for (const integration of SUPPORTED_INTEGRATIONS) {
        expect(INTEGRATION_DISPLAY_NAMES[integration]).toBeDefined();
        expect(typeof INTEGRATION_DISPLAY_NAMES[integration]).toBe("string");
      }
    });
  });

  describe("isValidIntegration", () => {
    it("returns true for valid integrations", () => {
      expect(isValidIntegration("slack")).toBe(true);
      expect(isValidIntegration("notion")).toBe(true);
      expect(isValidIntegration("googlecalendar")).toBe(true);
    });

    it("returns false for invalid integrations", () => {
      expect(isValidIntegration("invalid")).toBe(false);
      expect(isValidIntegration("")).toBe(false);
      expect(isValidIntegration("Slack")).toBe(false); // case-sensitive
    });
  });

  describe("getIntegrationDisplayName", () => {
    it("returns display name for valid integrations", () => {
      expect(getIntegrationDisplayName("slack")).toBe("Slack");
      expect(getIntegrationDisplayName("googlecalendar")).toBe("Google Calendar");
      expect(getIntegrationDisplayName("hubspot")).toBe("HubSpot");
    });

    it("returns the input for invalid integrations", () => {
      expect(getIntegrationDisplayName("unknown")).toBe("unknown");
      expect(getIntegrationDisplayName("custom-integration")).toBe("custom-integration");
    });
  });
});

describe("connectors/schema", () => {
  describe("InitiateResponseSchema", () => {
    it("parses successful initiate response", () => {
      const result = InitiateResponseSchema.parse({
        redirect_url: "https://oauth.example.com/authorize",
        connection_id: "conn_123",
      });
      expect(result.redirect_url).toBe("https://oauth.example.com/authorize");
      expect(result.connection_id).toBe("conn_123");
    });

    it("parses already authorized response", () => {
      const result = InitiateResponseSchema.parse({
        already_authorized: true,
      });
      expect(result.already_authorized).toBe(true);
    });

    it("parses error response with other user", () => {
      const result = InitiateResponseSchema.parse({
        error: "different_user",
        other_user_email: "other@example.com",
      });
      expect(result.error).toBe("different_user");
      expect(result.other_user_email).toBe("other@example.com");
    });
  });

  describe("StatusResponseSchema", () => {
    it("parses active status", () => {
      const result = StatusResponseSchema.parse({
        status: "ACTIVE",
        account_email: "user@example.com",
      });
      expect(result.status).toBe("ACTIVE");
      expect(result.account_email).toBe("user@example.com");
    });

    it("parses pending status", () => {
      const result = StatusResponseSchema.parse({
        status: "PENDING",
      });
      expect(result.status).toBe("PENDING");
    });

    it("parses failed status with error", () => {
      const result = StatusResponseSchema.parse({
        status: "FAILED",
        error: "User denied access",
      });
      expect(result.status).toBe("FAILED");
      expect(result.error).toBe("User denied access");
    });

    it("rejects invalid status", () => {
      expect(() =>
        StatusResponseSchema.parse({ status: "UNKNOWN" })
      ).toThrow();
    });
  });

  describe("ConnectorSchema", () => {
    it("parses and transforms connector data", () => {
      const result = ConnectorSchema.parse({
        integration_type: "slack",
        status: "ACTIVE",
        connected_at: "2024-01-15T10:30:00Z",
        account_info: {
          email: "user@example.com",
          name: "Test User",
        },
      });

      // Verify transformation to camelCase
      expect(result.integrationType).toBe("slack");
      expect(result.status).toBe("ACTIVE");
      expect(result.connectedAt).toBe("2024-01-15T10:30:00Z");
      expect(result.accountInfo?.email).toBe("user@example.com");
      expect(result.accountInfo?.name).toBe("Test User");
    });

    it("handles missing optional fields", () => {
      const result = ConnectorSchema.parse({
        integration_type: "notion",
        status: "ACTIVE",
      });

      expect(result.integrationType).toBe("notion");
      expect(result.connectedAt).toBeUndefined();
      expect(result.accountInfo).toBeUndefined();
    });
  });

  describe("ListResponseSchema", () => {
    it("parses list of connectors", () => {
      const result = ListResponseSchema.parse({
        integrations: [
          {
            integration_type: "slack",
            status: "ACTIVE",
            account_info: { email: "slack@example.com" },
          },
          {
            integration_type: "notion",
            status: "ACTIVE",
          },
        ],
      });

      expect(result.integrations).toHaveLength(2);
      expect(result.integrations[0].integrationType).toBe("slack");
      expect(result.integrations[1].integrationType).toBe("notion");
    });

    it("parses empty list", () => {
      const result = ListResponseSchema.parse({
        integrations: [],
      });
      expect(result.integrations).toHaveLength(0);
    });
  });

  describe("ApiErrorSchema", () => {
    it("parses error with detail", () => {
      const result = ApiErrorSchema.parse({
        error: "Unauthorized",
        detail: "Invalid token",
      });
      expect(result.error).toBe("Unauthorized");
      expect(result.detail).toBe("Invalid token");
    });

    it("parses error without detail", () => {
      const result = ApiErrorSchema.parse({
        error: "Not found",
      });
      expect(result.error).toBe("Not found");
      expect(result.detail).toBeUndefined();
    });
  });
});
