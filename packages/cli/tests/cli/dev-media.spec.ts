import { describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("media in dev", () => {
  const t = setupCLITests();

  it("should upload public file and serve it", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev");
    const url = await waitForDevServer(handle);

    const form = new FormData();
    form.append(
      "file",
      new Blob(["hello world"], { type: "text/plain" }),
      "test.txt",
    );

    const uploadRes = await fetch(
      `${url}/api/apps/test-app-id/integration-endpoints/Core/UploadFile`,
      { method: "POST", body: form },
    );
    expect(uploadRes.status).toBe(200);

    const { file_url } = (await uploadRes.json()) as { file_url: string };
    expect(file_url).toMatch(/\/media\/.+\.txt$/);

    const fileRes = await fetch(file_url);
    expect(fileRes.status).toBe(200);
    expect(await fileRes.text()).toBe("hello world");

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});
