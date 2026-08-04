import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const DOMAIN = {
  hostname: "app.example.com",
  cname_target: "b44apps.dev",
  status: "pending" as const,
  ssl_status: "pending_validation" as const,
  active: false,
  pending_deployment: false,
  verification: {
    ownership_verification: {
      type: "txt",
      name: "_cf-custom-hostname.app.example.com",
      value: "abc123",
    },
    ownership_verification_http: {
      http_url:
        "http://app.example.com/.well-known/cf-custom-hostname-challenge/x",
      http_body: "body",
    },
    ssl_validation_records: [
      { txt_name: "_acme-challenge.app.example.com", txt_value: "zzz" },
    ],
    ssl_validation_errors: null,
  },
};

const ACTIVE_DOMAIN = {
  ...DOMAIN,
  status: "active" as const,
  ssl_status: "active" as const,
  active: true,
};

describe("domains add command", () => {
  const t = setupCLITests();

  it("prints the CNAME record and status", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainAdd(DOMAIN);

    const result = await t.run("domains", "add", "app.example.com");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("CNAME");
    t.expectResult(result).toContain("app.example.com");
    t.expectResult(result).toContain("b44apps.dev");
  });

  it("outputs JSON with --json (snake→camel transform)", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainAdd(DOMAIN);

    const result = await t.run("domains", "add", "app.example.com", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hostname).toBe("app.example.com");
    expect(parsed.cnameTarget).toBe("b44apps.dev");
    expect(parsed.sslStatus).toBe("pending_validation");
    expect(parsed.pendingDeployment).toBe(false);
    expect(parsed.verification.ownershipVerification).toEqual({
      type: "txt",
      name: "_cf-custom-hostname.app.example.com",
      value: "abc123",
    });
  });

  it("waits until the domain is active with --wait", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainAdd(DOMAIN);
    // First poll of listDomains returns the active domain (no delay incurred).
    t.api.mockDomainList({ domains: [ACTIVE_DOMAIN] });

    const result = await t.run("domains", "add", "app.example.com", "--wait");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("app.example.com is active");
  });

  it("fails when the API returns an error", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainAddError({
      status: 400,
      body: { message: "invalid hostname" },
    });

    const result = await t.run("domains", "add", "bad_host");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("invalid hostname");
  });
});

describe("domains list command", () => {
  const t = setupCLITests();

  it("lists custom domains", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainList({
      domains: [DOMAIN, { ...ACTIVE_DOMAIN, hostname: "www.example.com" }],
    });

    const result = await t.run("domains", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("app.example.com");
    t.expectResult(result).toContain("www.example.com");
    t.expectResult(result).toContain("2 domains");
  });

  it("lists domains as JSON with --json", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainList({ domains: [DOMAIN] });

    const result = await t.run("domains", "list", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.domains).toHaveLength(1);
    expect(parsed.domains[0].hostname).toBe("app.example.com");
    expect(parsed.domains[0].cnameTarget).toBe("b44apps.dev");
    expect(parsed.domains[0].active).toBe(false);
  });

  it("shows an empty-state message when there are no domains", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainList({ domains: [] });

    const result = await t.run("domains", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No custom domains found");
  });
});

describe("domains remove command", () => {
  const t = setupCLITests();

  it("requires -y in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));

    const result = await t.run("domains", "remove", "app.example.com");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--yes is required in non-interactive mode",
    );
  });

  it("removes a domain with -y", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainRemove("app.example.com", {
      hostname: "app.example.com",
      deleted: true,
    });

    const result = await t.run("domains", "remove", "app.example.com", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Disconnected app.example.com");
  });

  it("surfaces the API error", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDomainRemoveError("app.example.com", {
      status: 500,
      body: { message: "Server error" },
    });

    const result = await t.run("domains", "remove", "app.example.com", "-y");

    t.expectResult(result).toFail();
  });
});
