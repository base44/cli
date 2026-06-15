# Run frontend `serveCommand` from `base44 dev` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `base44 dev` start the project's frontend dev server (`site.serveCommand`, e.g. `npm run dev` → vite) alongside the backend dev server, in one foreground process, with Base44 env vars injected into the frontend.

**Architecture:** A new `ServeRunner` (sibling of `FunctionManager`) owns the frontend child process — `child_process.spawn` with `shell: true`, a non-Windows process group for tree-kill, line-prefixed `[frontend]` output, and group/tree termination. `createDevServer` is the single lifecycle owner: it builds the injected env, creates the `ServeRunner`, adds it to `shutdown()`, and tears everything down if the frontend exits. `devAction` is the policy layer: parses `--no-serve`/`--write-env`, resolves the app id, and owns the `--write-env`-gated `.env.local` write.

**Tech Stack:** TypeScript, Bun, `child_process`, Commander.js, Vitest (testkit integration + a focused unit spec).

**Spec:** `docs/superpowers/specs/2026-06-15-dev-serve-command-design.md`

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/cli/src/cli/dev/createDevLogger.ts` | Dev logger; gains optional `[label]` prefix | Modify |
| `packages/cli/src/cli/dev/dev-server/serve-runner.ts` | Owns the frontend child process (spawn, output, tree-kill, onExit) | Create |
| `packages/cli/src/cli/dev/dev-server/main.ts` | Wire `ServeRunner` into the dev-server lifecycle | Modify |
| `packages/cli/src/cli/commands/dev.ts` | Flags, app-id resolution, `--write-env` file write | Modify |
| `packages/cli/tests/cli/serve-runner.spec.ts` | Unit tests for `ServeRunner` | Create |
| `packages/cli/tests/cli/dev.spec.ts` | Integration tests; update `.env.local` expectations | Modify |
| `docs/commands.md` (or dev docs) | Document `--no-serve` / `--write-env` and serve behavior | Modify |

---

## Phase 1 — Labeled dev logger

### Task 1: Add an optional `[label]` prefix to `createDevLogger`

**Files:**
- Modify: `packages/cli/src/cli/dev/createDevLogger.ts`

- [ ] **Step 1: Replace the `createDevLogger` factory to accept a label + color**

Replace the exported `createDevLogger` function (keep `DevLogger`, `colorByType`, `stringify` as-is, and the existing `import { theme }`):

```typescript
export function createDevLogger(
  label?: string,
  labelColor: (text: string) => string = theme.styles.dim,
): DevLogger {
  const prefix = label ? `${labelColor(`[${label}]`)} ` : "";
  const print = (type: LogType, ...args: unknown[]) => {
    const colorize = colorByType[type];
    console[type](
      prefix + args.map((item) => colorize(stringify(item))).join(" "),
    );
  };

  return {
    log: (...args: unknown[]) => print("log", ...args),
    error: (msg: unknown, err?: unknown) => {
      print("error", msg);
      if (err) {
        print("error", err);
      }
    },
    warn: (...args: unknown[]) => print("warn", ...args),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no callers break — `label` is optional, existing `createDevLogger()` calls still compile).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/cli/dev/createDevLogger.ts
git commit -m "feat(cli): support label prefix in dev logger"
```

---

## Phase 2 — `ServeRunner`

### Task 2: Create `ServeRunner` with a failing unit test (spawn + env injection)

**Files:**
- Create: `packages/cli/src/cli/dev/dev-server/serve-runner.ts`
- Test: `packages/cli/tests/cli/serve-runner.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/cli/serve-runner.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";

function fakeLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (...args: unknown[]) => lines.push(args.join(" ")),
      error: (msg: unknown) => lines.push(String(msg)),
      warn: (...args: unknown[]) => lines.push(args.join(" ")),
    },
  };
}

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("ServeRunner", () => {
  it("spawns the command with injected env vars", async () => {
    const { lines, logger } = fakeLogger();
    const runner = new ServeRunner({
      command: `node -e "console.log('APP=' + process.env.VITE_BASE44_APP_ID)"`,
      cwd: process.cwd(),
      env: { VITE_BASE44_APP_ID: "abc-123" },
      logger,
    });

    runner.start();
    await waitFor(() => lines.some((l) => l.includes("APP=abc-123")));
    await runner.stop();

    expect(lines.some((l) => l.includes("APP=abc-123"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test serve-runner.spec`
Expected: FAIL — `Cannot find module '@/cli/dev/dev-server/serve-runner.js'`.

- [ ] **Step 3: Create the minimal `ServeRunner`**

Create `packages/cli/src/cli/dev/dev-server/serve-runner.ts`:

```typescript
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import process from "node:process";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";

interface ServeRunnerOptions {
  command: string;
  cwd: string;
  env: Record<string, string>;
  logger: DevLogger;
}

export class ServeRunner {
  private readonly command: string;
  private readonly cwd: string;
  private readonly env: Record<string, string>;
  private readonly logger: DevLogger;
  private child?: ChildProcess;
  private stopping = false;
  private readonly exitListeners: Array<(code: number | null) => void> = [];

  constructor(options: ServeRunnerOptions) {
    this.command = options.command;
    this.cwd = options.cwd;
    this.env = options.env;
    this.logger = options.logger;
  }

  start(): void {
    if (this.child) {
      return;
    }
    const child = spawn(this.command, {
      cwd: this.cwd,
      shell: true,
      // A dedicated process group lets stop() tree-kill `npm -> vite`.
      detached: process.platform !== "win32",
      env: { ...process.env, ...this.env },
      stdio: ["inherit", "pipe", "pipe"],
    });
    this.child = child;
    this.setupHandlers(child);
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      return;
    }
    this.stopping = true;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else if (child.pid) {
      // Negative pid targets the whole process group (the shell + its children).
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    }
    await exited;
  }

  private setupHandlers(child: ChildProcess): void {
    child.stdout?.on("data", (data: Buffer) => this.emitLines(data, "log"));
    child.stderr?.on("data", (data: Buffer) => this.emitLines(data, "error"));

    child.on("error", (error) => {
      this.logger.error("Frontend dev server failed to start:", error);
      this.notifyExit(null);
    });

    child.on("exit", (code) => {
      if (this.stopping) {
        return;
      }
      this.logger.error(`Frontend dev server exited with code ${code}`);
      this.notifyExit(code);
    });
  }

  private notifyExit(code: number | null): void {
    for (const listener of this.exitListeners) {
      listener(code);
    }
  }

  private emitLines(data: Buffer, type: "log" | "error"): void {
    const lines = data.toString().trimEnd().split("\n");
    for (const line of lines) {
      if (type === "error") {
        this.logger.error(line);
      } else {
        this.logger.log(line);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test serve-runner.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli/dev/dev-server/serve-runner.ts packages/cli/tests/cli/serve-runner.spec.ts
git commit -m "feat(cli): add ServeRunner for the frontend dev process"
```

### Task 3: Test `stop()` terminates the process and `onExit` fires on self-exit

**Files:**
- Modify: `packages/cli/tests/cli/serve-runner.spec.ts`

- [ ] **Step 1: Add the failing tests**

Append inside the `describe("ServeRunner", ...)` block:

```typescript
  it("stop() terminates a long-running process", async () => {
    const { logger } = fakeLogger();
    const exitCodes: Array<number | null> = [];
    const runner = new ServeRunner({
      command: `node -e "setInterval(() => {}, 1000)"`,
      cwd: process.cwd(),
      env: {},
      logger,
    });
    runner.onExit((code) => exitCodes.push(code));

    runner.start();
    await new Promise((r) => setTimeout(r, 200));
    await runner.stop();

    // stop() must resolve, and the intentional stop must NOT fire onExit.
    expect(exitCodes).toEqual([]);
  });

  it("fires onExit when the process exits on its own", async () => {
    const { logger } = fakeLogger();
    const exitCodes: Array<number | null> = [];
    const runner = new ServeRunner({
      command: `node -e "process.exit(3)"`,
      cwd: process.cwd(),
      env: {},
      logger,
    });
    runner.onExit((code) => exitCodes.push(code));

    runner.start();
    await waitFor(() => exitCodes.length > 0);

    expect(exitCodes).toEqual([3]);
  });
```

- [ ] **Step 2: Run tests**

Run: `bun run test serve-runner.spec`
Expected: PASS (implementation from Task 2 already satisfies these — `stopping` guard suppresses `onExit` on intentional stop; self-exit reports the code).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/tests/cli/serve-runner.spec.ts
git commit -m "test(cli): cover ServeRunner stop and self-exit"
```

---

## Phase 3 — Wire `ServeRunner` into `createDevServer`

### Task 4: Tag backend logs and start/stop the frontend in `createDevServer`

**Files:**
- Modify: `packages/cli/src/cli/dev/dev-server/main.ts`

- [ ] **Step 1: Import `ServeRunner` and the theme**

Add to the imports at the top of `main.ts`:

```typescript
import { theme } from "@/cli/utils/index.js";
import { ServeRunner } from "./serve-runner.js";
```

- [ ] **Step 2: Add the `serve` option to `DevServerOptions`**

In the `DevServerOptions` interface, add after `denoWrapperPath: string;`:

```typescript
  serve?: { appId: string };
```

- [ ] **Step 3: Tag the backend dev logger**

Replace:

```typescript
  const devLogger = createDevLogger();
```

with:

```typescript
  const devLogger = createDevLogger("backend", theme.styles.info);
```

- [ ] **Step 4: Create, wire, and start the `ServeRunner`**

Locate the block that creates the watcher and the `shutdown` closure (currently ~lines 191-245). Replace from the `const base44ConfigWatcher = new WatchBase44(` line through the **end of the function** (the final `return { port, server };`) with the following (this re-includes the unchanged watcher block, so there is exactly one `return`):

```typescript
  const base44ConfigWatcher = new WatchBase44(
    {
      functions: join(dirname(project.configPath), project.functionsDir),
      entities: join(dirname(project.configPath), project.entitiesDir),
    },
    devLogger,
  );
  base44ConfigWatcher.on("change", async (name) => {
    try {
      const { functions, entities } = await options.loadResources();

      if (name === "functions") {
        const previousFunctionCount = functionManager.getFunctionNames().length;
        await functionManager.reload(functions);

        const names = functionManager.getFunctionNames();
        if (names.length > 0) {
          devLogger.log(`Reloaded functions: ${names.sort().join(", ")}`);
        } else if (previousFunctionCount > 0) {
          devLogger.log("All functions removed");
        }
      }

      if (name === "entities") {
        const previousEntityCount = db.getCollectionNames().length;
        db.dropAll();
        if (previousEntityCount > 0) {
          devLogger.log("Entities directory changed, clearing data...");
        }
        await db.load(entities);
        if (db.getCollectionNames().length > 0) {
          devLogger.log(
            `Loaded entities: ${db.getCollectionNames().join(", ")}`,
          );
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      devLogger.error(errorMessage);
    }
  });
  await base44ConfigWatcher.start();

  // Start the frontend dev server when serving is enabled AND the project
  // configures a serveCommand. Otherwise stay backend-only, silently.
  let serveRunner: ServeRunner | undefined;
  if (options.serve && project.site?.serveCommand) {
    serveRunner = new ServeRunner({
      command: project.site.serveCommand,
      cwd: options.cwd,
      env: {
        VITE_BASE44_APP_ID: options.serve.appId,
        VITE_BASE44_APP_BASE_URL: baseUrl,
      },
      logger: createDevLogger("frontend", theme.colors.base44Orange),
    });
  }

  const shutdown = async () => {
    base44ConfigWatcher.close();
    io.close();
    await functionManager.stopAll();
    await serveRunner?.stop();
    server.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // If the frontend dies, tear the whole dev environment down.
  serveRunner?.onExit(() => {
    void shutdown().finally(() => process.exit(1));
  });
  serveRunner?.start();

  return { port, server };
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (`project.site?.serveCommand` is valid — `project` is `ProjectWithPaths` which carries `site`.)

- [ ] **Step 6: Build (integration tests run against the built CLI)**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 7: Run the existing dev tests to confirm no regression in backend-only mode**

Run: `bun run test dev.spec`
Expected: The serve-related `.env.local` tests will FAIL here (they are updated in Phase 5). The non-env tests (server starts, auth, media) should PASS. Note which fail; do not fix yet.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/cli/dev/dev-server/main.ts
git commit -m "feat(cli): run frontend serveCommand from the dev server lifecycle"
```

---

## Phase 4 — `devAction` policy layer

### Task 5: Add `--no-serve` / `--write-env`, resolve app id, drop the default `.env.local`

**Files:**
- Modify: `packages/cli/src/cli/commands/dev.ts`

- [ ] **Step 1: Replace `DevOptions`, the env-file helper, `devAction`, and `getDevCommand`**

Replace the `DevOptions` interface, `writeEnvLocalIfMissing`, `devAction`, and `getDevCommand` (lines 13-78) with:

```typescript
interface DevOptions {
  port?: string;
  /** Commander sets this to false when `--no-serve` is passed; defaults to true. */
  serve?: boolean;
  writeEnv?: boolean;
}

function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Force-write `.env.local` with the app ID and dev server URL the frontend
 * needs. Only called when `--write-env` is passed — by default we inject these
 * values into the spawned frontend process instead of touching the filesystem.
 */
async function writeEnvLocal(
  projectRoot: string,
  port: number,
  appId: string,
  log: Logger,
): Promise<void> {
  const envLocalPath = join(projectRoot, ".env.local");
  await writeFile(
    envLocalPath,
    `VITE_BASE44_APP_ID=${appId}\nVITE_BASE44_APP_BASE_URL=${localServerUrl(port)}\n`,
  );
  log.info("Wrote .env.local with app ID and dev server URL");
}

async function devAction(
  { log }: CLIContext,
  options: DevOptions,
): Promise<RunCommandResult> {
  const port = options.port ? Number(options.port) : undefined;
  const serveEnabled = options.serve !== false;
  let projectRoot: string | undefined;

  // The app id is needed to inject env into the frontend and/or to write
  // `.env.local`. Resolve it up front when either path is active.
  const appId =
    serveEnabled || options.writeEnv
      ? (await initAppContext()).id
      : undefined;

  const { port: resolvedPort } = await createDevServer({
    log,
    port,
    cwd: process.cwd(),
    denoWrapperPath: getDenoWrapperPath(),
    serve: serveEnabled && appId ? { appId } : undefined,
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      projectRoot = project.root;
      return { functions, entities, project };
    },
  });

  if (options.writeEnv && projectRoot && appId) {
    await writeEnvLocal(projectRoot, resolvedPort, appId, log);
  }

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`,
  };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .option("--no-serve", "Do not start the frontend dev server (serveCommand)")
    .option(
      "--write-env",
      "Write the app ID and dev server URL to .env.local",
    )
    .action(devAction);
}
```

- [ ] **Step 2: Remove the now-unused `pathExists` import**

In the imports, change:

```typescript
import { pathExists, writeFile } from "@/core/utils/fs.js";
```

to:

```typescript
import { writeFile } from "@/core/utils/fs.js";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (Confirm `initAppContext()` resolves to an object with `id` — see `app-config.ts:38`.)

- [ ] **Step 4: Build**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli/commands/dev.ts
git commit -m "feat(cli): add --no-serve/--write-env and inject env into the frontend"
```

---

## Phase 5 — Integration tests

### Task 6: Update the `.env.local` integration tests to the new default

**Files:**
- Modify: `packages/cli/tests/cli/dev.spec.ts`

- [ ] **Step 1: Replace the two `.env.local` tests**

Replace the test `it("creates .env.local with app ID and dev server URL when it does not exist", ...)` and the test `it("does not overwrite .env.local when it already exists", ...)` with:

```typescript
  it("does not write .env.local by default", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    await handle.stop();

    const content = await t.readProjectFile(".env.local");
    expect(content).toBeNull();
  });

  it("writes .env.local with app ID and dev server URL when --write-env is passed", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev", "--write-env");
    await waitForDevServer(handle);
    await handle.stop();

    const content = await t.readProjectFile(".env.local");
    expect(content).toContain(`VITE_BASE44_APP_ID=${t.api.appId}`);
    expect(content).toContain("VITE_BASE44_APP_BASE_URL=http://localhost:");
  });
```

- [ ] **Step 2: Run the dev tests**

Run: `bun run test dev.spec`
Expected: PASS (`full-project` has no `serveCommand`, so `base44 dev` is backend-only; `readProjectFile` returns `null` when the file is absent — confirm `CLITestkit.readProjectFile` returns `null` for a missing file, per `CLITestkit.ts:312`).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/tests/cli/dev.spec.ts
git commit -m "test(cli): update .env.local expectations to --write-env default"
```

### Task 7: Integration test — frontend serveCommand runs with injected env

**Files:**
- Modify: `packages/cli/tests/cli/dev.spec.ts`

- [ ] **Step 1: Add a helper to write a config with a serveCommand, then the test**

Add this import near the top of `dev.spec.ts` if not present:

```typescript
import { writeFile } from "node:fs/promises";
```

(`writeFile` and `join` are already imported in this file; reuse them.)

Add a new test inside `describe("dev command", ...)`:

```typescript
  const writeConfigWithServeCommand = async (serveCommand: string) => {
    const configPath = join(
      t.getTempDir(),
      "project",
      "base44",
      "config.jsonc",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        name: "Full Project",
        site: { outputDirectory: "site-output", serveCommand },
      }),
    );
  };

  it("runs the frontend serveCommand with injected Base44 env vars", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    await writeConfigWithServeCommand(
      `node -e "console.log('SERVE_APP=' + process.env.VITE_BASE44_APP_ID + ' URL=' + process.env.VITE_BASE44_APP_BASE_URL); setInterval(() => {}, 1000)"`,
    );

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    await handle.waitForOutput(/SERVE_APP=/);
    await handle.stop();

    const output = handle.stdout.join("");
    expect(output).toContain(`SERVE_APP=${t.api.appId}`);
    expect(output).toContain("URL=http://localhost:");
    expect(output).toContain("[frontend]");
  });

  it("stays backend-only when --no-serve is passed", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    await writeConfigWithServeCommand(
      `node -e "console.log('SERVE_APP=' + process.env.VITE_BASE44_APP_ID); setInterval(() => {}, 1000)"`,
    );

    const handle = await t.runLive("dev", "--no-serve");
    await waitForDevServer(handle);
    await handle.stop();

    expect(handle.stdout.join("")).not.toContain("SERVE_APP=");
  });
```

- [ ] **Step 2: Run the dev tests**

Run: `bun run test dev.spec`
Expected: PASS. If the frontend output races the dev-server URL, `waitForOutput(/SERVE_APP=/)` covers it; the `[frontend]` prefix is produced by `createDevLogger("frontend", ...)`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/tests/cli/dev.spec.ts
git commit -m "test(cli): cover frontend serveCommand and --no-serve"
```

### Task 8: Integration test — frontend crash tears down the dev server

**Files:**
- Modify: `packages/cli/tests/cli/dev.spec.ts`

- [ ] **Step 1: Add the teardown test**

Add inside `describe("dev command", ...)`:

```typescript
  it("tears the dev server down when the frontend exits", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    // Frontend prints, then exits non-zero shortly after startup.
    await writeConfigWithServeCommand(
      `node -e "console.log('frontend up'); setTimeout(() => process.exit(1), 300)"`,
    );

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    const result = await handle.waitForExit();

    expect(result.exitCode).not.toBe(0);
  });
```

- [ ] **Step 2: Confirm the handle exposes an exit waiter**

Run: `grep -n "waitForExit\|exitCode\|onExit\|close" packages/cli/tests/cli/testkit/CLITestkit.ts`
Expected: a method on `RunLiveHandle` that resolves with the process exit. If the method is named differently (e.g. `stop()` returns the result, or there is a `wait()`/`done` promise), adapt this test to that API — assert the CLI process exited non-zero without calling `stop()`. Do not invent an API; match what `RunLiveHandle` actually exposes (see `CLITestkit.ts:36-44`).

- [ ] **Step 3: Run the dev tests**

Run: `bun run test dev.spec`
Expected: PASS — `serveRunner.onExit` triggers `shutdown()` + `process.exit(1)`, so the CLI process exits non-zero.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/tests/cli/dev.spec.ts
git commit -m "test(cli): cover dev teardown on frontend exit"
```

---

## Phase 6 — Docs & final verification

### Task 9: Document the behavior and flags

**Files:**
- Modify: `docs/commands.md` (and/or any dev-command-specific doc — search first)

- [ ] **Step 1: Find where the dev command / commands are documented**

Run: `grep -rn "base44 dev\|\"dev\"\|Start the development server\|serveCommand" docs/`
Expected: locate the dev-command section.

- [ ] **Step 2: Add a short section**

Document, in the existing style of that file:
- `base44 dev` starts the backend dev server and, when `site.serveCommand` is set, the frontend dev server too — one terminal.
- Env vars `VITE_BASE44_APP_ID` and `VITE_BASE44_APP_BASE_URL` are injected into the frontend process automatically (no `.env.local` needed).
- `--no-serve`: backend only.
- `--write-env`: also write `.env.local` with those values (for running the frontend standalone).
- Combined output is line-prefixed `[backend]` / `[frontend]`.

- [ ] **Step 3: Commit**

```bash
git add docs/commands.md
git commit -m "docs: document base44 dev frontend serve behavior and flags"
```

### Task 10: Full verification

- [ ] **Step 1: Lint**

Run: `bun run lint`
Expected: PASS (run `bun run lint:fix` if formatting differs, then re-run).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 4: Full test suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Manual smoke against chromaticlens**

Run (interactive, not in CI):
```bash
cd /Users/kfirs/dev/playground/chromaticlens && base44 dev
```
Expected: backend starts, `[frontend]` vite output appears with its `Local:` URL, the app loads against the local backend, and `Ctrl-C` cleanly stops both (no orphaned vite — verify with `pgrep -fl vite`).

---

## Notes for the implementer

- **Spawn failure vs crash:** with `shell: true`, a missing command (e.g. `npm` absent) surfaces as the shell exiting non-zero (code `127`), handled by the `exit` path → `onExit` → teardown. A genuine spawn `error` event (rare) is also routed to `onExit`. Both satisfy "fail clearly + tear down."
- **`--no-serve` never writes `.env.local`** (per spec). Only `--write-env` writes it.
- **Tagging scope:** the streaming `[backend]` tag covers request/function/watcher logs (the `devLogger`). The one-time "Loaded functions/entities" startup lines go through `options.log` (clack) and remain untagged — that's intentional and out of scope.
- **`baseUrl`** in `main.ts` is already `http://localhost:${port}` and is the value injected as `VITE_BASE44_APP_BASE_URL`.
