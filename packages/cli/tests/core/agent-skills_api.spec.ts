import { describe, expect, it, vi } from "vitest";

const put = vi.fn();
const post = vi.fn();
const del = vi.fn();
const get = vi.fn();

vi.mock("../../src/core/clients/index.js", () => ({
  getAppClient: () => ({ get, post, put, delete: del }),
}));

import { pushAgentSkills } from "../../src/core/resources/agent-skill/api.js";

function jsonResponse(data: unknown) {
  return { json: async () => data } as unknown as Response;
}

describe("pushAgentSkills reconcile", () => {
  it("creates new, updates changed, deletes removed", async () => {
    get.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { name: "keep", description: "same", body: "same" },
          { name: "change", description: "old", body: "old" },
          { name: "remove", description: "d", body: "b" },
        ],
        total: 3,
      }),
    );
    post.mockResolvedValue(jsonResponse({}));
    put.mockResolvedValue(jsonResponse({}));
    del.mockResolvedValue(jsonResponse({}));

    const result = await pushAgentSkills([
      { name: "keep", description: "same", body: "same" },
      { name: "change", description: "new", body: "new" },
      { name: "brand-new", description: "d", body: "b" },
    ]);

    expect(result).toEqual({
      created: ["brand-new"],
      updated: ["change"],
      deleted: ["remove"],
    });
    expect(post).toHaveBeenCalledWith(
      "agent-skills",
      expect.objectContaining({
        json: { name: "brand-new", description: "d", body: "b" },
      }),
    );
    expect(put).toHaveBeenCalledWith(
      "agent-skills/change",
      expect.objectContaining({
        json: { description: "new", body: "new" },
      }),
    );
    expect(del).toHaveBeenCalledWith("agent-skills/remove");
  });
});
