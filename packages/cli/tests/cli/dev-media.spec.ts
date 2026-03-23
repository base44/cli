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

  it("should upload secret file and serve it with token", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev");
    const url = await waitForDevServer(handle);

    // Upload a private file
    const form = new FormData();
    form.append(
      "file",
      new Blob(["secret content"], { type: "text/plain" }),
      "secret.txt",
    );

    const uploadRes = await fetch(
      `${url}/api/apps/test-app-id/integration-endpoints/Core/UploadPrivateFile`,
      { method: "POST", body: form },
    );
    expect(uploadRes.status).toBe(200);

    const { file_uri } = (await uploadRes.json()) as { file_uri: string };
    expect(file_uri).toMatch(/\.txt$/);

    // Get a signed URL for the private file
    const signedUrlRes = await fetch(
      `${url}/api/apps/test-app-id/integration-endpoints/Core/CreateFileSignedUrl`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_uri }),
      },
    );
    expect(signedUrlRes.status).toBe(200);

    const { signed_url } = (await signedUrlRes.json()) as {
      signed_url: string;
    };
    expect(signed_url).toContain("/media/private/");
    expect(signed_url).toContain("token=");

    // Fetch with valid token succeeds
    const fileRes = await fetch(signed_url);
    expect(fileRes.status).toBe(200);
    expect(await fileRes.text()).toBe("secret content");

    // Fetch with wrong token returns 400
    const badUrl = signed_url.replace(/token=.+$/, "token=invalid");
    const badRes = await fetch(badUrl);
    expect(badRes.status).toBe(400);
    const badBody = (await badRes.json()) as { error: string };
    expect(badBody.error).toBe("InvalidJWT");

    // Fetch with no token returns 401
    const noTokenUrl = signed_url.replace(/\?token=.+$/, "");
    const noTokenRes = await fetch(noTokenUrl);
    expect(noTokenRes.status).toBe(401);
    const noTokenBody = (await noTokenRes.json()) as { error: string };
    expect(noTokenBody.error).toBe("Missing token");

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});
