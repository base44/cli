import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Base44Client, createClient } from "@base44/sdk";
import { outdent } from "outdent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, type RunLiveHandle, setupCLITests } from "./testkit/index.js";

type UserCredentials = {
  email: string;
  password: string;
  name: string;
};

const adminUser: UserCredentials = {
  email: "test-admin@email.com",
  password: "12345678",
  name: "Test Admin",
};

const testUser: UserCredentials = {
  email: "test@test.com",
  password: "12345678",
  name: "Test",
};

const login = async (base44: Base44Client, user: UserCredentials) => {
  const { access_token } = await base44.auth.loginViaEmailPassword(
    user.email,
    user.password,
  );
  base44.setToken(access_token);
};

const registerAndLogin = async (
  base44: Base44Client,
  handle: RunLiveHandle,
  user: UserCredentials = adminUser,
) => {
  await base44.auth.register(user);

  const otpRegex =
    /In order to complete registration use this verification code: (\d{6})/;

  await handle.waitForOutput(otpRegex);

  const matches = [
    ...handle.stdout.join("\n").matchAll(new RegExp(otpRegex, "g")),
  ];
  const match = matches[matches.length - 1];

  const { access_token } = await base44.auth.verifyOtp({
    email: user.email,
    otpCode: match![1],
  });

  base44.setToken(access_token);
};

describe("Security in dev", () => {
  const t = setupCLITests();
  let handle: RunLiveHandle;
  let base44: Base44Client;

  beforeEach(async () => {
    await t.givenLoggedInWithProject(fixture("basic"), adminUser);

    const entitiesDir = join(t.getTempDir(), "project", "base44", "entities");
    await mkdir(entitiesDir, { recursive: true });
    await writeFile(
      join(entitiesDir, "task.jsonc"),
      outdent`
        {
          "name": "Task",
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "description": { "type": "string" },
            "can_be_updated": { "type": "boolean" },
            "protected": {
              "type": "string",
              "rls": {
                "write": {"user_condition": {"role": "admin"}},
                "read": {"user_condition": {"role": "admin"}}
              }
            }
          },
          "rls": {
            "create": true,
            "read": { "created_by": "{{user.email}}" },
            "update": {
              "$or": [
                {"created_by": "{{user.email}}"},
                {"user_condition": {"role": "admin"}}
              ]
            },
            "delete": {
              "$and": [
                {"user_condition": { "role": "admin" }},
                {"data.can_be_updated": true}
              ]
            }
          },
        }
      `,
    );

    handle = await t.runLive("dev");
    const serverUrl = await waitForDevServer(handle);

    base44 = createClient({
      appId: t.kit.api.appId,
      serverUrl,
    });

    await login(base44, adminUser);
  });

  afterEach(async () => {
    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  describe("RLS", () => {
    it("should not allow read of tasks between users", async () => {
      await base44.entities.Task.create({
        title: "Test",
        description: "Test description",
      });
      const tasks = await base44.entities.Task.list();
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe("Test");

      await registerAndLogin(base44, handle, testUser);
      const another_tasks = await base44.entities.Task.list();
      expect(another_tasks.length).toBe(0);

      await login(base44, adminUser);
      const verify_tasks = await base44.entities.Task.list();
      expect(verify_tasks.length).toBe(1);
      expect(verify_tasks[0].title).toBe("Test");
    });

    it("should not allow update of tasks between users", async () => {
      const { id } = await base44.entities.Task.create({
        title: "Test",
        description: "Test description",
      });
      await base44.entities.Task.update(id, {
        title: "Updated Title",
      });
      const tasks = await base44.entities.Task.list();
      expect(tasks[0].title).toBe("Updated Title");

      await registerAndLogin(base44, handle, testUser);

      await expect(
        base44.entities.Task.update(id, {
          title: "Updated Title From another user",
        }),
      ).rejects.toThrow(`Entity Task with ID ${id} not found`);
    });

    it("should allow delete only for admin role with can_be_updated", async () => {
      await registerAndLogin(base44, handle, testUser);
      const { id } = await base44.entities.Task.create({
        title: "Test",
        description: "Test description",
      });

      await expect(base44.entities.Task.delete(id)).rejects.toThrow(
        `Entity Task with ID ${id} not found`,
      );

      // RLS is defined in a way that only `admin` can delete task,
      // even though `admin` is not allowed to see it.
      await login(base44, adminUser);

      // First delete should fail, since `can_be_updated` is not yet set to `true`
      await expect(base44.entities.Task.delete(id)).rejects.toThrow(
        `Entity Task with ID ${id} not found`,
      );

      await base44.entities.Task.update(id, {
        can_be_updated: true,
      });

      await base44.entities.Task.delete(id);

      await login(base44, testUser);
      const tasks = await base44.entities.Task.list();
      expect(tasks.length).toBe(0);
    });

    it("admin should be able to update even if created by another user", async () => {
      await registerAndLogin(base44, handle, testUser);
      const { id } = await base44.entities.Task.create({
        title: "Test",
        description: "Test description",
      });

      await login(base44, adminUser);
      await base44.entities.Task.update(id, {
        title: "Updated Title by admin",
      });

      await login(base44, testUser);
      const tasks = await base44.entities.Task.list();
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe("Updated Title by admin");
    });
  });

  describe("FLS", () => {
    it("should not allow to write of protected property by user", async () => {
      await registerAndLogin(base44, handle, testUser);
      await base44.entities.Task.create({
        title: "Test",
        description: "Test description",
        protected: "Protected value",
      });
      const tasks = await base44.entities.Task.list();
      expect(tasks.length).toBe(1);
      expect(tasks[0].protected).toBeUndefined();
    });

    it("should allow write and read of protected property only by admin", async () => {
      await base44.entities.Task.create({
        title: "Test",
        description: "Test description",
        protected: "Protected value",
      });
      const tasks = await base44.entities.Task.list();
      expect(tasks.length).toBe(1);
      expect(tasks[0].protected).toBe("Protected value");

      await registerAndLogin(base44, handle, testUser);
      await base44.entities.Task.create({
        title: "Test 2",
        description: "Test description 2",
        protected: "Protected value 2",
      });

      const another_tasks = await base44.entities.Task.list();
      expect(another_tasks.length).toBe(1);
      expect(another_tasks[0].protected).toBeUndefined();
    });
  });
});
