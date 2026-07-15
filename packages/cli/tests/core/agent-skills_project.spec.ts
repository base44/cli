import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectConfig } from "../../src/core/project/config.js";

describe("readProjectConfig with agent skills", () => {
  it("loads agent-skills from the default dir", async () => {
    const root = join(__dirname, "../fixtures/with-agent-skills");
    const { agentSkills } = await readProjectConfig(root);
    expect(agentSkills).toEqual([
      {
        name: "weekly-report",
        description: "Summarize the week.",
        body: "Read tasks from the last 7 days and group them.",
      },
    ]);
  });
});
