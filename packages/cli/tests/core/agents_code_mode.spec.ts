import { describe, expect, it } from "vitest";
import {
  type AgentAccessConfig,
  AgentConfigSchema,
  type CodeModeConfig,
  type EntityAccessRule,
} from "../../src/core/resources/agent/schema.js";

/**
 * Minimal valid agent config, used as a base for tests below.
 */
const baseAgent = {
  name: "support",
  description: "Help desk",
  instructions: "Be helpful",
};

describe("AgentConfigSchema - code_mode", () => {
  it("validates a full code_mode block with entity rules and functions", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      code_mode: {
        access: {
          entities: {
            Order: {
              read: { created_by: "{{user.email}}" },
              create: true,
              update: { created_by: "{{user.email}}" },
              delete: false,
            },
          },
          functions: [{ name: "send_email" }],
        },
      },
    });

    expect(parsed.code_mode?.access.entities).toEqual({
      Order: {
        read: { created_by: "{{user.email}}" },
        create: true,
        update: { created_by: "{{user.email}}" },
        delete: false,
      },
    });
    expect(parsed.code_mode?.access.functions).toEqual([
      { name: "send_email" },
    ]);
  });

  it("is optional - configs without code_mode", () => {
    const parsed = AgentConfigSchema.parse(baseAgent);
    expect(parsed.code_mode).toBeUndefined();
  });

  it("accepts an empty code_mode with defaults applied", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      code_mode: {},
    });
    expect(parsed.code_mode?.access.entities).toEqual({});
    expect(parsed.code_mode?.access.functions).toEqual([]);
  });

  it("accepts partial access config with only entities", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      code_mode: {
        access: {
          entities: { Task: { read: true } },
        },
      },
    });
    expect(parsed.code_mode?.access.functions).toEqual([]);
  });

  it("accepts partial access config with only functions", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      code_mode: {
        access: {
          functions: [{ name: "notify" }],
        },
      },
    });
    expect(parsed.code_mode?.access.entities).toEqual({});
  });

  it.each([
    // MongoDB comparison operators
    { op: "$eq comparison", filter: { status: { $eq: "active" } } },
    { op: "$ne comparison", filter: { status: { $ne: "draft" } } },
    { op: "$in list", filter: { role: { $in: ["admin", "owner"] } } },
    // Logical operators
    {
      op: "$or array",
      filter: { $or: [{ created_by: "x" }, { shared_with: "x" }] },
    },
    { op: "$and array", filter: { $and: [{ a: 1 }, { b: 2 }] } },
    // Template variables (resolved at runtime on the backend)
    { op: "template variable", filter: { owner_email: "{{user.email}}" } },
    {
      op: "nested template in $or",
      filter: { $or: [{ owner: "{{user.id}}" }, { public: true }] },
    },
    // Nested dotted paths and mixed types
    { op: "nested dotted path", filter: { "meta.tags": "urgent" } },
    { op: "numeric value", filter: { priority: 5 } },
    { op: "null value", filter: { archived_at: null } },
    // Empty filter (matches everything)
    { op: "empty filter", filter: {} },
  ])("accepts filter rule shape: $op (no MongoDB semantic validation)", ({
    filter,
  }) => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      code_mode: {
        access: {
          entities: { Order: { read: filter } },
          functions: [],
        },
      },
    });
    expect(parsed.code_mode?.access.entities.Order.read).toEqual(filter);
  });

  it("rejects functions as an object instead of an array", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        code_mode: {
          access: {
            entities: {},
            functions: { send_email: true },
          },
        },
      }),
    ).toThrow();
  });

  it("rejects functions containing plain strings instead of objects", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        code_mode: {
          access: {
            entities: {},
            functions: ["send_email"],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects function entries missing the name field", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        code_mode: {
          access: {
            entities: {},
            functions: [{ description: "no name" }],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects entities as an array instead of an object", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        code_mode: {
          access: {
            entities: ["Order"],
            functions: [],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects an entity operation value that is a string", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        code_mode: {
          access: {
            entities: { Order: { read: "allow" } },
            functions: [],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects an entity operation value that is a number", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        code_mode: {
          access: {
            entities: { Order: { read: 1 } },
            functions: [],
          },
        },
      }),
    ).toThrow();
  });

  it("does not validate whether entity or function names exist (runtime concern)", () => {
    // Matches the user RLS philosophy: shape only, no semantic checks
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      code_mode: {
        access: {
          entities: {
            DoesNotExist: { read: true },
            AnotherFakeEntity: { update: { foo: "bar" } },
          },
          functions: [{ name: "not_a_real_function" }, { name: "also_fake" }],
        },
      },
    });
    expect(parsed.code_mode?.access.entities.DoesNotExist).toEqual({
      read: true,
    });
    expect(parsed.code_mode?.access.functions).toContainEqual({
      name: "also_fake",
    });
  });

  it("exports TypeScript types for EntityAccessRule, AgentAccessConfig, CodeModeConfig", () => {
    // Type-only assertion — compilation proves the types are exported and usable.
    const rule: EntityAccessRule = { created_by: "x" };
    const rule2: EntityAccessRule = true;
    const access: AgentAccessConfig = {
      entities: {},
      functions: [{ name: "test" }],
    };
    const codeMode: CodeModeConfig = { access };
    expect(rule).toBeDefined();
    expect(rule2).toBe(true);
    expect(access.entities).toEqual({});
    expect(codeMode.access.functions).toEqual([{ name: "test" }]);
  });
});
