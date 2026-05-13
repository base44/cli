import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectConfig } from "@/core/project/index.js";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

describe("readProjectConfig", () => {
  // Success cases
  it("reads basic project config", async () => {
    const result = await readProjectConfig(resolve(FIXTURES_DIR, "basic"));

    expect(result.project.name).toBe("Basic Test Project");
    expect(result.entities).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  it("reads project with entities", async () => {
    const result = await readProjectConfig(
      resolve(FIXTURES_DIR, "with-entities"),
    );

    expect(result.entities).toHaveLength(2);
    expect(result.entities.map((e) => e.name)).toContain("Customer");
    expect(result.entities.map((e) => e.name)).toContain("Product");
    expect(result.functions).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  it("reads project with functions and entities", async () => {
    const result = await readProjectConfig(
      resolve(FIXTURES_DIR, "with-functions-and-entities"),
    );

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("Order");
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("process-order");
    expect(result.functions[0].entry).toBe("index.ts");
    expect(result.agents).toEqual([]);
  });

  it("reads project plugins with automatic entity merging and namespaced functions", async () => {
    const result = await readProjectConfig(
      resolve(FIXTURES_DIR, "with-config-plugins"),
    );

    expect(result.entities.map((entity) => entity.name).sort()).toEqual([
      "AppOnly",
      "Customer",
      "Invoice",
    ]);

    const customer = result.entities.find(
      (entity) => entity.name === "Customer",
    );
    expect(customer?.properties).toHaveProperty("company");
    expect(customer?.properties).toHaveProperty("tier");
    expect(customer?.required).toEqual(["company", "tier"]);
    expect(customer?.source).toEqual({ type: "plugin", id: "crm" });

    const appOnly = result.entities.find((entity) => entity.name === "AppOnly");
    expect(appOnly?.source).toEqual({ type: "project" });

    expect(result.functions.map((fn) => fn.name).sort()).toEqual([
      "billing__createInvoice",
      "crm__syncCustomer",
    ]);

    const crmFunction = result.functions.find(
      (fn) => fn.name === "crm__syncCustomer",
    );
    expect(crmFunction).toMatchObject({
      source: {
        type: "plugin",
        id: "crm",
      },
    });
  });

  it("reads project with agents", async () => {
    const result = await readProjectConfig(
      resolve(FIXTURES_DIR, "with-agents"),
    );

    expect(result.agents).toHaveLength(3);
    expect(result.agents.map((a) => a.name)).toContain("customer_support");
    expect(result.agents.map((a) => a.name)).toContain("data_analyst");
    expect(result.agents.map((a) => a.name)).toContain("order_assistant");

    const customerSupport = result.agents.find(
      (a) => a.name === "customer_support",
    );
    expect(customerSupport?.tool_configs).toHaveLength(1);
    expect(customerSupport?.whatsapp_greeting).toBe(
      "Hi! I'm your support assistant. How can I help you today?",
    );
  });

  // Error cases
  it("throws when no config file exists", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "no-config")),
    ).rejects.toThrow(/Project root not found/);
  });

  it("throws on invalid JSON syntax", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "invalid-json")),
    ).rejects.toThrow();
  });

  it("throws on invalid config schema", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "invalid-config-schema")),
    ).rejects.toThrow(/Invalid project configuration/);
  });

  it("throws on invalid entity file", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "invalid-entity")),
    ).rejects.toThrow();
  });

  it("throws on invalid agent file", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "invalid-agent")),
    ).rejects.toThrow();
  });

  it("throws on duplicate agent names", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "duplicate-agent-names")),
    ).rejects.toThrow(/Duplicate agent name/);
  });

  it("throws on duplicate entity names", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "duplicate-entity-names")),
    ).rejects.toThrow(/Duplicate entity name/);
  });

  it("throws on duplicate plugin ids", async () => {
    await expect(
      readProjectConfig(resolve(FIXTURES_DIR, "plugin-duplicate-ids")),
    ).rejects.toThrow(/Duplicate plugin id/);
  });

  it("throws when plugins define the same entity name", async () => {
    await expect(
      readProjectConfig(
        resolve(
          FIXTURES_DIR,
          "plugin-validation-errors/duplicate-plugin-entities",
        ),
      ),
    ).rejects.toThrow(/Entity "Customer" is defined by more than one plugin/);
  });

  it("throws when a project entity overrides plugin properties", async () => {
    await expect(
      readProjectConfig(
        resolve(FIXTURES_DIR, "plugin-validation-errors/entity-override"),
      ),
    ).rejects.toThrow(/Cannot override plugin-defined property/);
  });

  it("throws when a plugin defines plugins", async () => {
    await expect(
      readProjectConfig(
        resolve(FIXTURES_DIR, "plugin-validation-errors/plugin-with-plugins"),
      ),
    ).rejects.toThrow(/Plugin projects cannot define plugins/);
  });
});
