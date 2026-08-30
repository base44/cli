import { describe, expect, it } from "vitest";
import {
  FunctionConfigSchema,
  ListFunctionsResponseSchema,
} from "@/core/resources/function/schema.js";

describe("Function connector automation schemas", () => {
  it("parses recursive trigger conditions without losing logic", () => {
    const result = FunctionConfigSchema.safeParse({
      name: "handle-slack-events",
      entry: "entry.ts",
      automations: [
        {
          name: "slack-router",
          type: "connector",
          integration_type: "slack",
          events: ["message"],
          trigger_conditions: {
            logic: "or",
            conditions: [
              {
                logic: "and",
                conditions: [
                  {
                    field: "event.channel",
                    operator: "equals",
                    value: "C_GENERAL",
                  },
                  {
                    field: "event.user",
                    operator: "equals",
                    value: "U_ALICE",
                  },
                ],
              },
              {
                field: "event.channel",
                operator: "equals",
                value: "C_SUPPORT",
              },
            ],
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected connector automation config to parse");
    }

    expect(result.data.automations).toEqual([
      {
        name: "slack-router",
        type: "connector",
        integration_type: "slack",
        events: ["message"],
        is_active: true,
        trigger_conditions: {
          logic: "or",
          conditions: [
            {
              logic: "and",
              conditions: [
                {
                  field: "event.channel",
                  operator: "equals",
                  value: "C_GENERAL",
                },
                {
                  field: "event.user",
                  operator: "equals",
                  value: "U_ALICE",
                },
              ],
            },
            {
              field: "event.channel",
              operator: "equals",
              value: "C_SUPPORT",
            },
          ],
        },
      },
    ]);
  });

  it("accepts catch-all connector automations with empty events", () => {
    const result = FunctionConfigSchema.safeParse({
      name: "handle-calendar-events",
      entry: "entry.ts",
      automations: [
        {
          name: "calendar-catch-all",
          type: "connector",
          integration_type: "googlecalendar",
          events: [],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts null and undefined to clear trigger conditions", () => {
    for (const triggerConditions of [null, undefined]) {
      const result = FunctionConfigSchema.safeParse({
        name: "clear-conditions",
        entry: "entry.ts",
        automations: [
          {
            name: "clearable-connector",
            type: "connector",
            integration_type: "slack",
            events: ["message"],
            trigger_conditions: triggerConditions,
          },
        ],
      });

      expect(result.success).toBe(true);
    }
  });

  it("rejects empty trigger condition forms that the backend also rejects", () => {
    const invalidForms = [
      {},
      { conditions: [] },
      { logic: "and", conditions: [] },
    ];

    for (const triggerConditions of invalidForms) {
      const result = FunctionConfigSchema.safeParse({
        name: "bad-conditions",
        entry: "entry.ts",
        automations: [
          {
            name: "bad-connector",
            type: "connector",
            integration_type: "slack",
            events: ["message"],
            trigger_conditions: triggerConditions,
          },
        ],
      });

      expect(result.success).toBe(false);
    }
  });

  it("accepts exists-style conditions without a value", () => {
    const result = FunctionConfigSchema.safeParse({
      name: "exists-filter",
      entry: "entry.ts",
      automations: [
        {
          name: "slack-has-thread-ts",
          type: "connector",
          integration_type: "slack",
          events: ["message"],
          trigger_conditions: {
            conditions: [
              {
                field: "event.thread_ts",
                operator: "exists",
              },
            ],
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects connector automation missing integration_type", () => {
    const result = FunctionConfigSchema.safeParse({
      name: "missing-integration",
      entry: "entry.ts",
      automations: [
        {
          name: "bad-connector",
          type: "connector",
          events: ["message"],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects condition group with zero conditions", () => {
    const result = FunctionConfigSchema.safeParse({
      name: "empty-group",
      entry: "entry.ts",
      automations: [
        {
          name: "empty-conditions",
          type: "connector",
          integration_type: "slack",
          events: ["message"],
          trigger_conditions: {
            conditions: [],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown automation type", () => {
    const result = FunctionConfigSchema.safeParse({
      name: "unknown-type",
      entry: "entry.ts",
      automations: [
        {
          name: "mystery",
          type: "webhook",
          url: "https://example.com",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("parses list responses with connector automations unchanged", () => {
    const result = ListFunctionsResponseSchema.safeParse({
      functions: [
        {
          name: "handle-webhooks",
          deployment_id: "dep_123",
          entry: "entry.ts",
          files: [{ path: "entry.ts", content: "Deno.serve(() => {})" }],
          automations: [
            {
              name: "slack-filter",
              type: "connector",
              integration_type: "slack",
              events: [],
              trigger_conditions: {
                logic: "and",
                conditions: [
                  {
                    field: "event.channel",
                    operator: "equals",
                    value: "C_GENERAL",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected functions list response to parse");
    }

    expect(result.data.functions[0]?.automations).toEqual([
      {
        name: "slack-filter",
        type: "connector",
        integration_type: "slack",
        events: [],
        is_active: true,
        trigger_conditions: {
          logic: "and",
          conditions: [
            {
              field: "event.channel",
              operator: "equals",
              value: "C_GENERAL",
            },
          ],
        },
      },
    ]);
  });
});

describe("Function scheduled automation schemas", () => {
  it("accepts null repeat intervals for weekly and monthly schedules", () => {
    for (const repeatUnit of ["weeks", "months"]) {
      const result = ListFunctionsResponseSchema.safeParse({
        functions: [
          {
            name: "scheduled-function",
            deployment_id: "dep_123",
            entry: "entry.ts",
            files: [{ path: "entry.ts", content: "" }],
            automations: [
              {
                name: `${repeatUnit}-schedule`,
                type: "scheduled",
                schedule_mode: "recurring",
                schedule_type: "simple",
                repeat_unit: repeatUnit,
                repeat_interval: null,
              },
            ],
          },
        ],
      });

      expect(result.success).toBe(true);
    }
  });
});
