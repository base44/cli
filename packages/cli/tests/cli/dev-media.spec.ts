import { type Base44Client, createClient } from "@base44/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, type RunLiveHandle, setupCLITests } from "./testkit/index.js";

describe("media in dev", () => {
  const t = setupCLITests();
  let handle: RunLiveHandle;
  let base44: Base44Client;

  beforeEach(async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    handle = await t.runLive("dev");
    const serverUrl = await waitForDevServer(handle);

    base44 = createClient({
      appId: t.kit.api.appId,
      serverUrl,
    });
  });

  afterEach(async () => {
    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("should upload public file and serve it", async () => {
    const file = new File(["hello world"], "test.txt", { type: "text/plain" });
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    expect(file_url).toMatch(/\/media\/.+\.txt$/);

    const fileRes = await fetch(file_url);
    expect(fileRes.status).toBe(200);
    expect(await fileRes.text()).toBe("hello world");
  });

  it("should upload secret file and serve it with token", async () => {
    const file = new File(["secret content"], "secret.txt", {
      type: "text/plain",
    });
    const { file_uri } = await base44.integrations.Core.UploadPrivateFile({
      file,
    });
    expect(file_uri).toMatch(/\.txt$/);

    // Get a signed URL for the private file
    const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({
      file_uri,
    });
    expect(signed_url).toContain("/media/private/");
    expect(signed_url).toContain("token=");

    // Fetch with valid token succeeds
    const fileRes = await fetch(signed_url);
    expect(fileRes.status).toBe(200);
    expect(await fileRes.text()).toBe("secret content");

    // Fetch with wrong token returns 400
    const badUrl = signed_url.replace(/([?&]token=)[^&]+/, "$1invalid");
    const badRes = await fetch(badUrl);
    expect(badRes.status).toBe(400);
    const badBody = (await badRes.json()) as { error: string };
    expect(badBody.error).toBe("InvalidJWT");

    // Fetch with no token returns 401
    const urlWithToken = new URL(signed_url);
    urlWithToken.searchParams.delete("token");
    const noTokenUrl = urlWithToken.toString();
    const noTokenRes = await fetch(noTokenUrl);
    expect(noTokenRes.status).toBe(401);
    const noTokenBody = (await noTokenRes.json()) as { error: string };
    expect(noTokenBody.error).toBe("Missing token");
  });
});
