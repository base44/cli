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

const login = async (base44: Base44Client, user: UserCredentials) => {
  const { access_token } = await base44.auth.loginViaEmailPassword(
    user.email,
    user.password,
  );
  base44.setToken(access_token);
};

describe("RLS $ne operator", () => {
  const t = setupCLITests();
  let handle: RunLiveHandle;
  let base44: Base44Client;

  describe("CRUD operations", () => {
    beforeEach(async () => {
      await t.givenLoggedInWithProject(fixture("basic"), adminUser);

      const entitiesDir = join(t.getTempDir(), "project", "base44", "entities");
      await mkdir(entitiesDir, { recursive: true });
      await writeFile(
        join(entitiesDir, "article.jsonc"),
        outdent`
          {
            "name": "Article",
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "status": { "type": "string" }
            },
            "rls": {
              "create": true,
              "read": {
                "data.status": { "$ne": "archived" }
              },
              "update": {
                "data.status": { "$ne": "archived" }
              },
              "delete": {
                "data.status": { "$ne": "archived" }
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

    it("should hide records whose field value equals the $ne value", async () => {
      await base44.entities.Article.create({
        title: "Active Article",
        status: "active",
      });
      await base44.entities.Article.create({
        title: "Draft Article",
        status: "draft",
      });
      await base44.entities.Article.create({
        title: "Archived Article",
        status: "archived",
      });

      const articles = await base44.entities.Article.list();
      expect(articles.length).toBe(2);
      expect(articles.map((a) => a.title).sort()).toEqual([
        "Active Article",
        "Draft Article",
      ]);
    });

    it("should allow update only when status does not equal the $ne value", async () => {
      const active = await base44.entities.Article.create({
        title: "Active",
        status: "active",
      });
      const archived = await base44.entities.Article.create({
        title: "Archived",
        status: "archived",
      });

      await base44.entities.Article.update(active.id, {
        title: "Updated Active",
      });

      await expect(
        base44.entities.Article.update(archived.id, {
          title: "Updated Archived",
        }),
      ).rejects.toThrow(`Entity Article with ID ${archived.id} not found`);
    });

    it("should allow delete only when status does not equal the $ne value", async () => {
      const archived = await base44.entities.Article.create({
        title: "Archived",
        status: "archived",
      });

      await expect(base44.entities.Article.delete(archived.id)).rejects.toThrow(
        `Entity Article with ID ${archived.id} not found`,
      );

      const active = await base44.entities.Article.create({
        title: "Active",
        status: "active",
      });

      await base44.entities.Article.delete(active.id);

      // Only the archived one remains (but it's not readable due to read $ne)
      const articles = await base44.entities.Article.list();
      expect(articles.length).toBe(0);
    });
  });

  describe("bulk create", () => {
    beforeEach(async () => {
      await t.givenLoggedInWithProject(fixture("basic"), adminUser);

      const entitiesDir = join(t.getTempDir(), "project", "base44", "entities");
      await mkdir(entitiesDir, { recursive: true });
      await writeFile(
        join(entitiesDir, "article.jsonc"),
        outdent`
          {
            "name": "Article",
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "status": { "type": "string" }
            },
            "rls": {
              "create": {
                "data.status": { "$ne": "archived" }
              },
              "read": true,
              "update": true,
              "delete": true
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

    it("should allow bulk create when no status equals the $ne value", async () => {
      const created = await base44.entities.Article.bulkCreate([
        { title: "Active", status: "active" },
        { title: "Draft", status: "draft" },
      ]);

      expect(created.length).toBe(2);

      const articles = await base44.entities.Article.list();
      expect(articles.length).toBe(2);
    });

    it("should deny bulk create when any status equals the $ne value", async () => {
      await expect(
        base44.entities.Article.bulkCreate([
          { title: "Active", status: "active" },
          { title: "Archived", status: "archived" },
        ]),
      ).rejects.toThrow();
    });
  });
});
