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
        }),
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
        await readFile(join(tmpDir, "my-custom-agent.jsonc"), "utf-8"),
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
        }),
      );
      await writeFile(
        join(tmpDir, "helper.jsonc"),
        JSON.stringify({
          name: "support",
          description: "Help desk",
          instructions: "Be helpful",
        }),
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
        await readFile(join(tmpDir, "support.jsonc"), "utf-8"),
      );
      expect(content.description).toBe("Updated help desk");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * Filename collision lifecycle:
   *
   * 1. Local has `greeter.jsonc` with name="hello_world" (filename ≠ name)
   * 2. Pull: server returns "hello_world" + new agent "greeter"
   *    → "hello_world" writes to existing `greeter.jsonc`
   *    → "greeter" can't use `greeter.jsonc` (taken) → gets `greeter_1.jsonc`
   * 3. Server removes "hello_world", pull again
   *    → `greeter.jsonc` deleted, `greeter_1.jsonc` stays
   * 4. Another pull — "greeter" still at `greeter_1.jsonc` (stable)
   */
  it("handles filename collision when a new agent's name matches an existing file used by a different agent", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agents-test-"));

    try {
      // Local: greeter.jsonc contains an agent named "hello_world"
      await writeFile(
        join(tmpDir, "greeter.jsonc"),
        JSON.stringify({
          name: "hello_world",
          description: "Says hello",
          instructions: "Greet everyone",
        }),
      );

      // Pull: server has both "hello_world" and a new agent named "greeter"
      // "hello_world" matches the existing file. "greeter" is new, but
      // greeter.jsonc is already taken — it should get a suffixed path.
      const pull1 = await writeAgents(tmpDir, [
        {
          name: "hello_world",
          description: "Says hello",
          instructions: "Greet everyone",
        },
        {
          name: "greeter",
          description: "General greeter",
          instructions: "Welcome users",
        },
      ]);

      expect(pull1.written).toEqual(["greeter"]);
      expect(pull1.deleted).toEqual([]);

      const filesAfterPull1 = (await readdir(tmpDir)).sort();
      expect(filesAfterPull1).toEqual(["greeter.jsonc", "greeter_1.jsonc"]);

      // greeter.jsonc still belongs to "hello_world"
      const helloFile = JSON.parse(
        await readFile(join(tmpDir, "greeter.jsonc"), "utf-8"),
      );
      expect(helloFile.name).toBe("hello_world");

      // greeter_1.jsonc has the new "greeter" agent
      const greeterFile = JSON.parse(
        await readFile(join(tmpDir, "greeter_1.jsonc"), "utf-8"),
      );
      expect(greeterFile.name).toBe("greeter");

      // Server removes "hello_world", pull again.
      // greeter.jsonc (hello_world) is deleted, greeter_1.jsonc stays.
      const pull2 = await writeAgents(tmpDir, [
        {
          name: "greeter",
          description: "General greeter",
          instructions: "Welcome users",
        },
      ]);

      expect(pull2.deleted).toEqual(["hello_world"]);
      expect(pull2.written).toEqual([]);

      const filesAfterPull2 = await readdir(tmpDir);
      expect(filesAfterPull2).toEqual(["greeter_1.jsonc"]);

      // Another pull — "greeter" is unchanged, still at greeter_1.jsonc
      const pull3 = await writeAgents(tmpDir, [
        {
          name: "greeter",
          description: "General greeter",
          instructions: "Welcome users",
        },
      ]);

      expect(pull3.written).toEqual([]);
      expect(pull3.deleted).toEqual([]);
      expect(await readdir(tmpDir)).toEqual(["greeter_1.jsonc"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
