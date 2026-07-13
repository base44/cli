import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SERVICE_ROLE_EMAIL } from "@/core/local-state/index.js";
import { runSeedScript } from "@/core/seed-script/index.js";

interface CapturedSpawn {
  command: string;
  args: string[];
  options: { env: Record<string, string | undefined>; stdio: unknown };
}

function fakeSpawn(exitCode: number, captured: CapturedSpawn[]) {
  return ((command: string, args: string[], options: unknown) => {
    captured.push({ command, args, options } as CapturedSpawn);
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => child.emit("close", exitCode));
    return child;
  }) as unknown as typeof spawn;
}

describe("runSeedScript", () => {
  let tempDir: string;
  let scriptPath: string;
  let wrapperPath: string;
  let captured: CapturedSpawn[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "b44-seed-script-"));
    scriptPath = join(tempDir, "seed.ts");
    wrapperPath = join(tempDir, "wrapper.ts");
    await writeFile(scriptPath, "export default async () => {};");
    await writeFile(wrapperPath, "// wrapper stub");
    captured = [];
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const run = (exitCode = 0) =>
    runSeedScript({
      appId: "app-123",
      scriptPath,
      localUrl: "http://localhost:4400",
      spawnImpl: fakeSpawn(exitCode, captured),
      wrapperPath,
    });

  it("spawns deno run on a copy of the wrapper", async () => {
    // When
    const result = await run();

    // Then
    expect(result.exitCode).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0].command).toBe("deno");
    const args = captured[0].args;
    expect(args.slice(0, 3)).toEqual([
      "run",
      "--allow-all",
      "--node-modules-dir=auto",
    ]);
    // Wrapper runs from a temp copy, not the shipped asset path
    expect(args[3]).toMatch(/\.ts$/);
    expect(args[3]).not.toBe(wrapperPath);
  });

  it("wires the local dev-server env with a service-subject token", async () => {
    // When
    await run();

    // Then
    const env = captured[0].options.env;
    expect(env.BASE44_APP_ID).toBe("app-123");
    expect(env.BASE44_LOCAL_URL).toBe("http://localhost:4400");
    expect(env.SCRIPT_PATH).toBe(pathToFileURL(scriptPath).href);

    const decoded = jwt.decode(env.BASE44_LOCAL_SERVICE_TOKEN as string);
    expect(decoded).toMatchObject({ sub: SERVICE_ROLE_EMAIL });
  });

  it("records the reason when remote credentials are unavailable", async () => {
    // Given: no app context in this process, so the remote token fetch fails

    // When
    await run();

    // Then: remote creds empty, reason recorded for ctx.remote() to throw
    const env = captured[0].options.env;
    expect(env.BASE44_ACCESS_TOKEN).toBe("");
    expect(env.BASE44_APP_BASE_URL).toBe("");
    expect(env.BASE44_REMOTE_ERROR).not.toBe("");
  });

  it("pipes child output instead of inheriting stdio", async () => {
    // When
    await run();

    // Then: stdout must stay clean for --json; both streams are piped
    expect(captured[0].options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("propagates a non-zero exit code", async () => {
    // When
    const result = await run(3);

    // Then
    expect(result.exitCode).toBe(3);
  });
});
