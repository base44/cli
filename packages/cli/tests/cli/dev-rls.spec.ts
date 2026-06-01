import { describe, expect, it } from "vitest";
import { applyFLS, checkRLS } from "@/cli/dev/dev-server/db/rls.js";
import type { Entity } from "@/core/resources/entity/schema.js";

const serviceUser = {
  email: "server@server.com",
  id: "service-role",
  is_service: true,
  role: "admin",
};

describe("dev RLS", () => {
  it("allows service users to bypass explicit false RLS rules", () => {
    expect(checkRLS(false, {}, serviceUser)).toBe(true);
  });

  it("treats explicit false FLS as deny for normal users and allow for service users", () => {
    const schema: Entity = {
      name: "PrivateNote",
      type: "object",
      properties: {
        title: { type: "string" },
        secret: {
          type: "string",
          rls: {
            read: false,
          },
        },
      },
      source: { type: "project" },
    };
    const record = { title: "Visible", secret: "Hidden" };

    expect(applyFLS(record, schema, undefined, "read")).toEqual({
      title: "Visible",
    });
    expect(applyFLS(record, schema, serviceUser, "read")).toEqual(record);
  });
});
