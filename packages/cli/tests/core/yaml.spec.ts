import { describe, expect, it } from "vitest";
import { formatYaml } from "../../src/cli/utils/yaml.js";

describe("formatYaml", () => {
  it("formats a simple object as YAML", () => {
    const result = formatYaml({
      name: "slack",
      description: "Slack connector",
    });
    expect(result).toBe("name: slack\ndescription: Slack connector");
  });

  it("strips null values by default", () => {
    const result = formatYaml({ name: "test", pattern: null });
    expect(result).not.toContain("pattern");
    expect(result).toContain("name: test");
  });

  it("strips undefined values by default", () => {
    const result = formatYaml({ name: "test", pattern: undefined });
    expect(result).not.toContain("pattern");
  });

  it("strips empty arrays by default", () => {
    const result = formatYaml({ name: "test", items: [] });
    expect(result).not.toContain("items");
  });

  it("strips empty strings by default", () => {
    const result = formatYaml({ name: "test", label: "" });
    expect(result).not.toContain("label");
  });

  it("keeps non-empty arrays", () => {
    const result = formatYaml({ items: ["a", "b"] });
    expect(result).toContain("- a");
    expect(result).toContain("- b");
  });

  it("preserves empty values when stripEmpty is false", () => {
    const result = formatYaml(
      { name: "test", items: [], label: "", value: null },
      { stripEmpty: false },
    );
    expect(result).toContain("items: []");
    expect(result).toContain("label:");
    expect(result).toContain("value: null");
  });

  it("formats nested objects with null stripping", () => {
    const result = formatYaml({
      integrationType: "gmail",
      connectionConfigFields: [
        {
          name: "client_id",
          displayName: "Client ID",
          validationPattern: null,
          validationError: null,
        },
      ],
    });
    expect(result).toContain("name: client_id");
    expect(result).toContain("displayName: Client ID");
    expect(result).not.toContain("validationPattern");
    expect(result).not.toContain("validationError");
  });
});
