import { describe, expect, it } from "vitest";

import { resolveHttpPrivateDataSourceUrl } from "../src/private-data-sources/http-url";
import type { PrivateDataSourceManifestEntry } from "../src/private-data-sources/types";

const entry: PrivateDataSourceManifestEntry = {
  name: "Wix Trino",
  type: "http",
  bindingName: "DATA_SOURCE_WIX_TRINO",
  bindingKind: "vpc_network",
  networkScope: "network",
  host: "trino.bi-use1.wixprod.net",
  baseUrl: "https://trino.bi-use1.wixprod.net:443",
};

describe("resolveHttpPrivateDataSourceUrl", () => {
  it("resolves relative paths against the base URL", () => {
    expect(resolveHttpPrivateDataSourceUrl(entry, "/v1/statement")).toBe(
      "https://trino.bi-use1.wixprod.net/v1/statement",
    );
  });

  it("passes absolute URLs through, including other tunnel hosts (Trino nextUri)", () => {
    expect(
      resolveHttpPrivateDataSourceUrl(entry, "https://trino-foxtrot.bi-use1.wixprod.net/v1/statement/x"),
    ).toBe("https://trino-foxtrot.bi-use1.wixprod.net/v1/statement/x");
  });

  it("returns Request inputs unchanged", () => {
    const req = new Request("https://trino.bi-use1.wixprod.net/v1/info");
    expect(resolveHttpPrivateDataSourceUrl(entry, req)).toBe(req);
  });

  it("coerces URL and other inputs to a string like fetch does", () => {
    expect(resolveHttpPrivateDataSourceUrl(entry, new URL("https://trino.bi-use1.wixprod.net/x"))).toBe(
      "https://trino.bi-use1.wixprod.net/x",
    );
  });

  it("falls back to a placeholder base when the entry has no base URL", () => {
    const noBase: PrivateDataSourceManifestEntry = { name: "x", type: "http" };
    expect(resolveHttpPrivateDataSourceUrl(noBase, "/health")).toBe("http://private-data-source.local/health");
  });
});
