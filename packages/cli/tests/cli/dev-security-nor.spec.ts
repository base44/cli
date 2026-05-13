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

describe("RLS $nor operator", () => {
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
              "status": { "type": "string" },
              "category": { "type": "string" }
            },
            "rls": {
              "create": true,
              "read": {
                "$nor": [
                  { "data.status": "archived" },
                  { "data.category": "restricted" }
                ]
              },
              "update": {
                "$nor": [
                  { "data.status": "archived" },
                  { "data.category": "restricted" }
                ]
              },
              "delete": {
                "$nor": [
                  { "data.status": "archived" },
                  { "data.category": "restricted" }
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

    it("should hide records matching any condition in $nor", async () => {
      await base44.entities.Article.create({
        title: "Active Public",
        status: "active",
        category: "public",
      });
      await base44.entities.Article.create({
        title: "Archived Public",
        status: "archived",
        category: "public",
      });
      await base44.entities.Article.create({
        title: "Active Restricted",
        status: "active",
        category: "restricted",
      });
      await base44.entities.Article.create({
        title: "Archived Restricted",
        status: "archived",
        category: "restricted",
      });

      const articles = await base44.entities.Article.list();
      expect(articles.length).toBe(1);
      expect(articles[0].title).toBe("Active Public");
    });

    it("should deny update when any $nor condition matches", async () => {
      const activePublic = await base44.entities.Article.create({
        title: "Active Public",
        status: "active",
        category: "public",
      });
      const archived = await base44.entities.Article.create({
        title: "Archived",
        status: "archived",
        category: "public",
      });
      const restricted = await base44.entities.Article.create({
        title: "Restricted",
        status: "active",
        category: "restricted",
      });

      await base44.entities.Article.update(activePublic.id, {
        title: "Updated Active Public",
      });

      await expect(
        base44.entities.Article.update(archived.id, {
          title: "Updated Archived",
        }),
      ).rejects.toThrow(`Entity Article with ID ${archived.id} not found`);

      await expect(
        base44.entities.Article.update(restricted.id, {
          title: "Updated Restricted",
        }),
      ).rejects.toThrow(`Entity Article with ID ${restricted.id} not found`);
    });

    it("should deny delete when any $nor condition matches", async () => {
      const archived = await base44.entities.Article.create({
        title: "Archived",
        status: "archived",
        category: "public",
      });
      const restricted = await base44.entities.Article.create({
        title: "Restricted",
        status: "active",
        category: "restricted",
      });

      await expect(base44.entities.Article.delete(archived.id)).rejects.toThrow(
        `Entity Article with ID ${archived.id} not found`,
      );
      await expect(
        base44.entities.Article.delete(restricted.id),
      ).rejects.toThrow(`Entity Article with ID ${restricted.id} not found`);

      const activePublic = await base44.entities.Article.create({
        title: "Active Public",
        status: "active",
        category: "public",
      });

      await base44.entities.Article.delete(activePublic.id);

      // Archived and restricted remain but are not readable due to read $nor
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
              "status": { "type": "string" },
              "category": { "type": "string" }
            },
            "rls": {
              "create": {
                "$nor": [
                  { "data.status": "archived" },
                  { "data.category": "restricted" }
                ]
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

    it("should allow bulk create when no record matches any $nor condition", async () => {
      const created = await base44.entities.Article.bulkCreate([
        { title: "Active Public 1", status: "active", category: "public" },
        { title: "Active Public 2", status: "draft", category: "public" },
      ]);

      expect(created.length).toBe(2);

      const articles = await base44.entities.Article.list();
      expect(articles.length).toBe(2);
    });

    it("should deny bulk create when any record matches a $nor condition", async () => {
      await expect(
        base44.entities.Article.bulkCreate([
          { title: "Active Public", status: "active", category: "public" },
          { title: "Archived Public", status: "archived", category: "public" },
        ]),
      ).rejects.toThrow();
    });
  });
});
