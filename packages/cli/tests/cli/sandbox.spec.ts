import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const APP_ID = "test-app-id";
const base = `/api/apps/${APP_ID}/sandbox-bridge`;

describe("sandbox commands", () => {
  const t = setupCLITests();

  it("ls prints the JSON result", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("POST", `${base}/list_directory`, (_req, res) => {
      res.status(200).json({
        entries: [{ name: "src", path: "src", type: "directory" }],
        truncated: false,
      });
    });

    // When
    const result = await t.run("sandbox", "ls", "--app-id", APP_ID);

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"type": "directory"');
  });

  it("--json writes a pure JSON document to stdout (status on stderr)", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("POST", `${base}/list_directory`, (_req, res) => {
      res.status(200).json({
        entries: [{ name: "src", path: "src", type: "directory" }],
        truncated: false,
      });
    });

    // When
    const result = await t.run("sandbox", "ls", "--app-id", APP_ID, "--json");

    // Then — stdout parses cleanly and carries no human status line
    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.entries[0].type).toBe("directory");
    expect(result.stdout).not.toContain("Listed directory");
  });

  it("read passes paths and returns file content", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("POST", `${base}/read_file`, (req, res) => {
      res.status(200).json({
        files: [
          {
            path: req.body.paths[0],
            content: "hello world",
            start_line: 1,
            end_line: 1,
            total_lines: 1,
            truncated: false,
          },
        ],
      });
    });

    // When
    const result = await t.run(
      "sandbox",
      "read",
      "notes.txt",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("hello world");
  });

  it("write sends content from --content flag", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("POST", `${base}/write_file`, (req, res) => {
      res.status(200).json({
        path: req.body.path,
        bytes_written: (req.body.content ?? "").length,
        created: true,
        overwritten: false,
      });
    });

    // When
    const result = await t.run(
      "sandbox",
      "write",
      "notes.txt",
      "--content",
      "hello",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"created": true');
  });

  it("write reads content from stdin when --content is omitted", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    // Surrounding whitespace must be preserved (file content is sent verbatim).
    t.givenStdin("  hi  ");
    t.api.mockRoute("POST", `${base}/write_file`, (req, res) => {
      res.status(200).json({
        path: req.body.path,
        bytes_written: (req.body.content ?? "").length,
        created: true,
        overwritten: false,
      });
    });

    // When
    const result = await t.run(
      "sandbox",
      "write",
      "notes.txt",
      "--app-id",
      APP_ID,
    );

    // Then — 6 bytes ("  hi  "), proving stdin is not trimmed
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"bytesWritten": 6');
  });

  it("run surfaces the remote exit code without failing the CLI", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("POST", `${base}/run_command`, (_req, res) => {
      res.status(200).json({
        stdout: "",
        stderr: "boom",
        exit_code: 2,
        truncated: false,
        duration_ms: 5,
      });
    });

    // When
    const result = await t.run("sandbox", "run", "exit 2", "--app-id", APP_ID);

    // Then — the HTTP call succeeded, so the CLI exits 0; the code is in the JSON
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"exitCode": 2');
  });

  it("checkpoint creates a restore point with the given name", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("POST", `${base}/create_checkpoint`, (_req, res) => {
      res.status(200).json({
        checkpoint_id: "cp_123",
        name: "before refactor",
        git_commit_hash: "abc123",
      });
    });

    // When
    const result = await t.run(
      "sandbox",
      "checkpoint",
      "--name",
      "before refactor",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"checkpointId": "cp_123"');
    t.expectResult(result).toContain('"gitCommitHash": "abc123"');
  });

  it("edit surfaces a backend error code", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockError("post", `${base}/edit_file`, {
      status: 400,
      body: {
        message: "old_text is not unique in the file.",
        extra_data: { code: "EDIT_TEXT_NOT_UNIQUE" },
      },
    });

    // When
    const result = await t.run(
      "sandbox",
      "edit",
      "src/x.ts",
      "--edits-json",
      '[{"old_text":"a","new_text":"b"}]',
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not unique");
  });

  it("hints to re-login when the response indicates a missing sandbox scope", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockError("post", `${base}/write_file`, {
      status: 403,
      body: {
        message:
          "Missing required OAuth scope 'sandbox:write'. Reconnect granting sandbox access.",
        extra_data: { code: "NOT_AUTHORIZED" },
      },
    });

    // When
    const result = await t.run(
      "sandbox",
      "write",
      "notes.txt",
      "--content",
      "hi",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("base44 login");
    t.expectResult(result).toContain("grant sandbox access");
  });

  it("does NOT add the re-login hint to a generic 403 (re-login wouldn't help)", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockError("post", `${base}/write_file`, {
      status: 403,
      body: {
        message: "You have view-only access to this app.",
        extra_data: { code: "NOT_AUTHORIZED" },
      },
    });

    // When
    const result = await t.run(
      "sandbox",
      "write",
      "notes.txt",
      "--content",
      "hi",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("view-only access");
    t.expectResult(result).toNotContain("grant sandbox access");
  });

  it("edit rejects malformed --edits-json before calling the API", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When
    const result = await t.run(
      "sandbox",
      "edit",
      "src/x.ts",
      "--edits-json",
      "not json",
      "--app-id",
      APP_ID,
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("valid JSON");
  });

  it("fails when no app ID is available", async () => {
    // Given — logged in, but no --app-id, no env, and no linked project
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When
    const result = await t.run("sandbox", "ls");

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("--json emits failures as a JSON error envelope on stdout", async () => {
    // Given — no app id resolvable, so the lifecycle throws before the action
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When
    const result = await t.run("sandbox", "ls", "--json");

    // Then — stdout is a parseable error envelope, not plain text
    t.expectResult(result).toFail();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.error).toContain("No Base44 app ID found");
    expect(Array.isArray(parsed.hints)).toBe(true);
  });
});
