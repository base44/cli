import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATIC_EGRESS_ARTIFACT_MARKER } from "@base44/functions-compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidInputError } from "@/core/errors.js";
import { compileBackendBundles } from "@/core/version/functions.js";

describe("compileBackendBundles", () => {
  let root: string;
  const functionsDir = () => join(root, "base44", "functions");

  async function givenFile(path: string, content: string): Promise<void> {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "b44-functions-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is an empty set for an app with no functions, without loading the compiler", async () => {
    // The standalone binary cannot load the compiler, and an app with no
    // functions must still publish from it.
    expect(await compileBackendBundles(root, functionsDir())).toEqual([]);
  });

  it("compiles every function into one shard, at the production modes", async () => {
    await givenFile(
      "base44/functions/greet/entry.ts",
      `Deno.serve(() => new Response("hi"));\n`,
    );
    await givenFile(
      "base44/functions/report/entry.ts",
      `import { format } from "../../shared/format.ts";\nDeno.serve(() => new Response(format(1)));\n`,
    );
    await givenFile(
      "base44/shared/format.ts",
      "export const format = (n: number) => '#' + n;\n",
    );

    const [bundle, ...rest] = await compileBackendBundles(root, functionsDir());

    expect(rest).toEqual([]);
    expect(bundle).toMatchObject({
      // A flat function keeps the `main.ts` it has always compiled as; one that
      // reaches a shared module compiles under its real path.
      functions: [
        { name: "greet", entry: "main.ts" },
        { name: "report", entry: "base44/functions/report/entry.ts" },
      ],
      wrapper: {
        secrets: "binding",
        postResponseTelemetry: false,
        staticEgress: STATIC_EGRESS_ARTIFACT_MARKER,
      },
    });
    expect(bundle.size).toBe(bundle.module.byteLength);
    expect(bundle.digest).toBe(
      `sha256:${createHash("sha256").update(bundle.module).digest("hex")}`,
    );
    expect(new TextDecoder().decode(bundle.module)).toMatch(
      /^\/\/!b44:1 \{"functions":\["greet","report"\],"telemetry":false,"runtimeSecrets":false/,
    );
  });

  it("compiles the same functions to the same bytes", async () => {
    // A version is named by the digest, so a rebuild of unchanged code must
    // not mint a new one.
    await givenFile(
      "base44/functions/b/entry.ts",
      "Deno.serve(() => new Response('b'));\n",
    );
    await givenFile(
      "base44/functions/a/entry.ts",
      "Deno.serve(() => new Response('a'));\n",
    );

    const first = await compileBackendBundles(root, functionsDir());
    const second = await compileBackendBundles(root, functionsDir());

    expect(second.map((b) => b.digest)).toEqual(first.map((b) => b.digest));
    expect(first[0].functions.map((f) => f.name)).toEqual(["a", "b"]);
  });

  it("fails the whole set when one function does not compile", async () => {
    await givenFile(
      "base44/functions/good/entry.ts",
      "Deno.serve(() => new Response('ok'));\n",
    );
    await givenFile("base44/functions/broken/entry.ts", "Deno.serve(() => {\n");

    const error = await compileBackendBundles(root, functionsDir()).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).details.join("\n")).toContain("broken");
  });
});
