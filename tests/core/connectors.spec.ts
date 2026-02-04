import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllConnectors } from "../../src/core/resources/connector/config.js";
import {
  ConnectorResourceSchema,
  IntegrationTypeSchema,
} from "../../src/core/resources/connector/schema.js";

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

  it("throws error when filename does not match type", async () => {
    const connectorsDir = resolve(
      FIXTURES_DIR,
      "connector-type-mismatch/connectors"
    );

    await expect(readAllConnectors(connectorsDir)).rejects.toThrow(
      /does not match type/
    );
  });
});
