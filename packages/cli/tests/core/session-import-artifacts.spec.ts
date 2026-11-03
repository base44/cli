import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectArtifacts } from "@/core/session-import/artifacts.js";

describe("collectArtifacts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "b44-artifacts-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("drops the oldest artifacts until the upload fits the request budget", async () => {
    const entries = [];
    for (const [i, name] of ["a.html", "b.pdf", "c.png"].entries()) {
      const path = join(dir, name);
      await writeFile(path, "x".repeat(400));
      entries.push({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `toolu_${i}`,
              name: "Artifact",
              input: { file_path: path, description: name },
            },
          ],
        },
      });
    }
    const session = Buffer.from(
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
    );

    const { artifacts, skipped } = await collectArtifacts(session, 900);

    expect(artifacts.map((a) => [a.toolUseId, a.fileName])).toEqual([
      ["toolu_1", "b.pdf"],
      ["toolu_2", "c.png"],
    ]);
    expect(skipped).toEqual([
      { fileName: "a.html", reason: "the upload would be over 95 MB" },
    ]);
  });
});
