import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readAllAgents,
  writeAgents,
} from "../../src/core/resources/agent/config.js";
import type { AgentConfigApiResponse } from "../../src/core/resources/agent/schema.js";

describe("writeAgents", () => {
  it("writes remote agents to files", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agents-test-"));

    try {
      const remoteAgents: AgentConfigApiResponse[] = [
        {
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        },
        { name: "sales", description: "Sales bot", instructions: "Sell stuff" },
      ];

      const { written, deleted } = await writeAgents(tmpDir, remoteAgents);

      expect(written).toEqual(["support", "sales"]);
      expect(deleted).toEqual([]);

      const agents = await readAllAgents(tmpDir);
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name).sort()).toEqual(["sales", "support"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes local agents not in remote list", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agents-test-"));

    try {
      const initial: AgentConfigApiResponse[] = [
        {
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        },
        { name: "sales", description: "Sales bot", instructions: "Sell stuff" },
      ];
      await writeAgents(tmpDir, initial);

      const remote: AgentConfigApiResponse[] = [
        {
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        },
      ];
      const { written, deleted } = await writeAgents(tmpDir, remote);

      expect(written).toEqual([]);
      expect(deleted).toEqual(["sales"]);

      const agents = await readAllAgents(tmpDir);
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("support");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes to existing file when name matches even if filename differs", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agents-test-"));

    try {
      await writeFile(
        join(tmpDir, "my-custom-agent.jsonc"),
        JSON.stringify({
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        })
      );

      const remoteAgents: AgentConfigApiResponse[] = [
        {
          name: "support",
          description: "Updated help desk",
          instructions: "Be very helpful",
        },
      ];

      const { written, deleted } = await writeAgents(tmpDir, remoteAgents);

      expect(written).toEqual(["support"]);
      expect(deleted).toEqual([]);

      const files = await readdir(tmpDir);
      expect(files).toEqual(["my-custom-agent.jsonc"]);

      const content = JSON.parse(
        await readFile(join(tmpDir, "my-custom-agent.jsonc"), "utf-8")
      );
      expect(content.description).toBe("Updated help desk");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes file with non-matching filename when name is not in remote", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agents-test-"));

    try {
      await writeFile(
        join(tmpDir, "old-agent.jsonc"),
        JSON.stringify({
          name: "legacy",
          description: "Old agent",
          instructions: "Do old things",
        })
      );
      await writeFile(
        join(tmpDir, "helper.jsonc"),
        JSON.stringify({
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        })
      );

      const remoteAgents: AgentConfigApiResponse[] = [
        {
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        },
      ];

      const { written, deleted } = await writeAgents(tmpDir, remoteAgents);

      expect(written).toEqual([]);
      expect(deleted).toEqual(["legacy"]);

      const files = await readdir(tmpDir);
      expect(files).toEqual(["helper.jsonc"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips writing when data is unchanged, preserving comments and formatting", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agents-test-"));

    try {
      const fileContent = `// My support agent\n{\n  "name": "support",\n  "description": "Help desk",\n  "instructions": "Be helpful"\n}\n`;
      await writeFile(join(tmpDir, "support.jsonc"), fileContent);

      const remoteAgents: AgentConfigApiResponse[] = [
        {
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        },
      ];

      const { written, deleted } = await writeAgents(tmpDir, remoteAgents);

      expect(written).toEqual([]);
      expect(deleted).toEqual([]);

      const rawContent = await readFile(join(tmpDir, "support.jsonc"), "utf-8");
      expect(rawContent).toBe(fileContent);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes when data has changed even if file has comments", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agents-test-"));

    try {
      const fileContent = `// My support agent\n{\n  "name": "support",\n  "description": "Help desk",\n  "instructions": "Be helpful"\n}\n`;
      await writeFile(join(tmpDir, "support.jsonc"), fileContent);

      const remoteAgents: AgentConfigApiResponse[] = [
        {
          name: "support",
          description: "Updated help desk",
          instructions: "Be very helpful",
        },
      ];

      const { written, deleted } = await writeAgents(tmpDir, remoteAgents);

      expect(written).toEqual(["support"]);
      expect(deleted).toEqual([]);

      const content = JSON.parse(
        await readFile(join(tmpDir, "support.jsonc"), "utf-8")
      );
      expect(content.description).toBe("Updated help desk");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
