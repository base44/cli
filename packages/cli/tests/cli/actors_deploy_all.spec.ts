import { cp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("actors in unified deploy", () => {
  const t = setupCLITests();

  it("deploys an actor-only project", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    const actors: string[] = [];
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/:name`,
      (req, res) => {
        actors.push(String(req.params.name));
        res.json({ status: "deployed", warnings: ["Check deployment"] });
      },
    );
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    const result = await t.run("deploy", "-y");
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("2 actors");
    t.expectResult(result).toContain("Check deployment");
    t.expectResult(result).toContain("App deployed successfully");
    expect(actors).toEqual(["ChatRoom", "Counter"]);
  });

  it.each([
    "success",
    "function",
    "actor",
  ])("runs resources in order and stops after a failed stage: %s", async (failure) => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    await cp(
      fixture("with-actors/base44/actors"),
      join(t.getTempDir(), "project/base44/actors"),
      { recursive: true },
    );
    await cp(
      fixture("with-functions-and-entities/base44/functions"),
      join(t.getTempDir(), "project/base44/functions"),
      { recursive: true },
    );
    const stages: string[] = [];
    t.api.mockEntitiesPush({ created: ["Task"], updated: [], deleted: [] });
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/backend-functions/:name`,
      (req, res) => {
        stages.push(`function:${req.params.name}`);
        if (failure === "function" && req.params.name === "hello")
          res.status(400).json({ detail: "Function failed" });
        else res.json({ status: "deployed" });
      },
    );
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/:name`,
      (req, res) => {
        stages.push(`actor:${req.params.name}`);
        if (failure === "actor" && req.params.name === "ChatRoom")
          res.status(400).json({ detail: "Actor failed" });
        else res.json({ status: "deployed" });
      },
    );
    t.api.mockRoute(
      "GET",
      `/api/apps/${t.api.appId}/external-auth/list`,
      (_req, res) => {
        stages.push("connectors");
        res.json({ integrations: [] });
      },
    );
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockSiteDeploy({ app_url: "https://test.base44.app" });

    const result = await t.run("deploy", "-y", "--json");

    expect(stages.slice(0, 2).sort()).toEqual([
      "function:hello",
      "function:process-order",
    ]);
    if (failure === "success") {
      t.expectResult(result).toSucceed();
      expect(stages.slice(2)).toEqual([
        "actor:ChatRoom",
        "actor:Counter",
        "connectors",
      ]);
    } else {
      t.expectResult(result).toFail();
      const error = JSON.parse(result.stdout);
      expect(error.code).toBe("RESOURCE_DEPLOYMENT_FAILED");
      expect(error.details.join("\n")).toContain("Entities synced: 1");
      expect(error.details.join("\n")).toContain(
        "Function process-order: deployed",
      );
      expect(stages).not.toContain("connectors");
      t.expectResult(result).toNotContain("App deployed successfully");
      if (failure === "function") expect(stages).toHaveLength(2);
      else {
        expect(stages.slice(2)).toEqual(["actor:ChatRoom", "actor:Counter"]);
        expect(error.details.join("\n")).toContain("Counter: deployed");
      }
    }
  });
});
