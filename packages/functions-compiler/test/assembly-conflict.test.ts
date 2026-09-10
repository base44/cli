import { describe, expect, it } from "vitest";

import { importsConflictingPackage } from "../src/bundler";
import type { BundleErrorItem } from "../src/errors";

// The real assembly error from prod app 68da7245efa2ba7a0ede4746: date-fns-tz@2
// deep-imports date-fns subpaths that date-fns@4's exports map doesn't expose.
const TZ_CONFLICT: BundleErrorItem[] = [
  {
    message:
      "[ERR_PACKAGE_PATH_NOT_EXPORTED] Package subpath './format/index.js' is not " +
      "defined by \"exports\" in '/home/node/.cache/deno/npm/registry.npmjs.org/" +
      "date-fns/4.1.0/package.json' imported from 'file:///home/node/.cache/deno/" +
      "npm/registry.npmjs.org/date-fns-tz/2.0.1/esm/format/index.js'",
  },
];

const entry = (source: string) => ({
  index: 0,
  fn: { name: "fn", entry: "main.ts", files: { "main.ts": source } },
});

describe("importsConflictingPackage", () => {
  it("blames a function importing the failing major", () => {
    expect(
      importsConflictingPackage(
        entry("import { format } from 'npm:date-fns-tz@^2.0.0';"),
        TZ_CONFLICT,
      ),
    ).toBe(true);
  });

  it("blames an unpinned import of the failing package", () => {
    expect(
      importsConflictingPackage(
        entry("import { format } from 'npm:date-fns-tz';"),
        TZ_CONFLICT,
      ),
    ).toBe(true);
  });

  it("exonerates a function pinned to a different major", () => {
    expect(
      importsConflictingPackage(
        entry("import { toZonedTime } from 'npm:date-fns-tz@3.2.0';"),
        TZ_CONFLICT,
      ),
    ).toBe(false);
  });

  it("does not blame importers of the resolved-to package", () => {
    // date-fns@4 is where resolution landed, not the package whose imports
    // broke — its importers are fine alone and together.
    expect(
      importsConflictingPackage(
        entry("import { addMinutes } from 'npm:date-fns@4.1.0';"),
        TZ_CONFLICT,
      ),
    ).toBe(false);
  });

  it("handles scoped packages", () => {
    const errors: BundleErrorItem[] = [
      {
        message:
          "[ERR_PACKAGE_PATH_NOT_EXPORTED] Package subpath './x' is not defined " +
          "by \"exports\" in '/cache/npm/registry.npmjs.org/left-pad/1.0.0/package.json' " +
          "imported from 'file:///cache/npm/registry.npmjs.org/@acme/utils/2.3.0/esm/x.js'",
      },
    ];
    expect(
      importsConflictingPackage(
        entry("import { pad } from 'npm:@acme/utils@^2.0.0';"),
        errors,
      ),
    ).toBe(true);
    expect(
      importsConflictingPackage(
        entry("import { pad } from 'npm:@acme/utils@3.1.0';"),
        errors,
      ),
    ).toBe(false);
  });

  it("blames nothing when errors carry no npm origin", () => {
    expect(
      importsConflictingPackage(
        entry("import { format } from 'npm:date-fns-tz@^2.0.0';"),
        [{ message: "something exploded" }],
      ),
    ).toBe(false);
  });
});
