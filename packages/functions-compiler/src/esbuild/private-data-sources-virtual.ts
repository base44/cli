import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "esbuild";
import { ACTIVATION_FILENAME } from "../worker-entry.js";
import { USER_NAMESPACE } from "./user-files.js";

const PREFIX = "base44:private-data-sources";
export const PRIVATE_DATA_SOURCES_NAMESPACE = "base44-private-data-sources";
const MODULE_DIR = new URL("../private-data-sources/", import.meta.url);
const PUBLIC_MODULES = new Set([
  "elasticsearch",
  "http",
  "mariadb",
  "mongodb",
  "mysql",
  "postgres",
  "redis",
  "sqlserver",
]);

function publicModulePath(specifier: string): string | null {
  if (specifier === PREFIX) return null;
  if (!specifier.startsWith(`${PREFIX}/`)) return null;
  const moduleName = specifier.slice(PREFIX.length + 1);
  if (!PUBLIC_MODULES.has(moduleName)) return null;
  return `${moduleName}.ts`;
}

// Internal, NOT user-importable: the activation shim writes the handshake
// manifest into this store and manifest.ts reads it. Resolving it for user code
// would let it read/forge the manifest (plaintext VPC/DB credentials). Gated by
// an ALLOW-list — the ONLY legitimate importer is the injected activation shim.
//
// The shim is always injected at the bundle-ROOT key ACTIVATION_FILENAME (see
// prepareFunction/prepareApp), so its esbuild importer is EXACTLY that string in
// the user namespace — the same trusted-platform-basename shape main uses for
// base44:internal/runtime-context (see runtime-context-virtual). Match the
// namespace AND the exact key: a suffix/segment match (`.../x/__base44_activation.mjs`,
// `fn_3/.../__base44_activation.mjs`) would let a NESTED user file with that
// basename pose as the shim and read the manifest. `assertNoReservedFilenames`
// rejects that basename at any depth in every mode (as it does for the sibling
// __base44_* platform files), so no user file can ever hold it. The store shares
// PRIVATE_DATA_SOURCES_NAMESPACE with manifest.ts so both dedupe to one module
// instance in the final bundle.
const INTERNAL_STORE_SPECIFIER = `${PREFIX}/runtime-manifest-store`;

function isActivationShimImporter(
  namespace: string,
  importer: string,
): boolean {
  return namespace === USER_NAMESPACE && importer === ACTIVATION_FILENAME;
}

function relativeModulePath(
  importer: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const importerDir = importer.includes("/")
    ? importer.slice(0, importer.lastIndexOf("/"))
    : "";
  const resolved = path.posix.normalize(
    path.posix.join(importerDir, specifier),
  );
  if (
    resolved.startsWith("../") ||
    resolved === ".." ||
    path.posix.isAbsolute(resolved)
  )
    return null;
  return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
}

function loadModule(modulePath: string) {
  return readFileSync(new URL(modulePath, MODULE_DIR), "utf8");
}

export function privateDataSourcesVirtualPlugin(): Plugin {
  return {
    name: "base44-private-data-sources-virtual",
    setup(build) {
      build.onResolve(
        { filter: /^base44:private-data-sources(?:\/.*)?$/ },
        (args) => {
          if (args.path === INTERNAL_STORE_SPECIFIER) {
            if (!isActivationShimImporter(args.namespace, args.importer)) {
              return {
                errors: [
                  {
                    text:
                      `"${args.path}" is internal to the Base44 runtime and cannot be imported ` +
                      "by backend function code.",
                  },
                ],
              };
            }
            return {
              path: "runtime-manifest-store.ts",
              namespace: PRIVATE_DATA_SOURCES_NAMESPACE,
            };
          }
          const modulePath = publicModulePath(args.path);
          if (!modulePath) {
            return {
              errors: [
                {
                  text:
                    `Unsupported import "${args.path}". Use a type-specific private data source import, ` +
                    'for example "base44:private-data-sources/postgres".',
                },
              ],
            };
          }
          return {
            path: modulePath,
            namespace: PRIVATE_DATA_SOURCES_NAMESPACE,
          };
        },
      );

      build.onResolve(
        {
          filter: /^\.\.?\//,
          namespace: PRIVATE_DATA_SOURCES_NAMESPACE,
        },
        (args) => {
          const modulePath = relativeModulePath(args.importer, args.path);
          if (!modulePath) {
            return {
              errors: [
                {
                  text: `Invalid private data source module import "${args.path}"`,
                },
              ],
            };
          }
          return {
            path: modulePath,
            namespace: PRIVATE_DATA_SOURCES_NAMESPACE,
          };
        },
      );

      build.onLoad(
        { filter: /.*/, namespace: PRIVATE_DATA_SOURCES_NAMESPACE },
        (args) => ({
          contents: loadModule(args.path),
          loader: "ts",
        }),
      );
    },
  };
}
