import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { globby } from "globby";
import { InvalidInputError } from "@/core/errors.js";
import { pathExists } from "@/core/utils/fs.js";
import type { ModuleType, WorkerModule } from "./schema.js";
import type { ResolvedWranglerConfig } from "./wrangler-config.js";

const MAX_TOTAL_MODULE_BYTES = 40 * 1024 * 1024; // 40 MB

/** Files never collected as worker modules. */
const MODULE_IGNORE = ["wrangler.json", ".dev.vars"];

/** Wrangler rule type → deployments API module type. */
const RULE_TYPE_TO_MODULE_TYPE: Record<string, ModuleType> = {
  ESModule: "esm",
  CompiledWasm: "wasm",
  Text: "text",
  Data: "data",
};

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export async function collectModules(
  config: ResolvedWranglerConfig,
): Promise<WorkerModule[]> {
  const entryPath = resolve(config.configDir, config.main);
  if (!(await pathExists(entryPath))) {
    throw new InvalidInputError(
      `Worker entry module does not exist: ${entryPath} (from "main" in ${config.configPath})`,
      {
        hints: [{ message: "Rebuild the project to regenerate the artifact" }],
      },
    );
  }

  const modulesByName = new Map<string, WorkerModule>();
  const entryName = toPosix(relative(config.configDir, entryPath));
  modulesByName.set(entryName, {
    name: entryName,
    absolutePath: entryPath,
    size: 0,
    type: "esm",
  });

  const ignore = [...MODULE_IGNORE];
  if (config.assetsDirectory?.startsWith(config.configDir + sep)) {
    ignore.push(
      `${toPosix(relative(config.configDir, config.assetsDirectory))}/**`,
    );
  }

  for (const rule of config.rules) {
    const type = RULE_TYPE_TO_MODULE_TYPE[rule.type];
    if (!type) {
      throw new InvalidInputError(
        `Unsupported module rule type "${rule.type}" in ${config.configPath}. Supported: ${Object.keys(RULE_TYPE_TO_MODULE_TYPE).join(", ")}.`,
      );
    }

    const matches = await globby(rule.globs, {
      cwd: config.configDir,
      onlyFiles: true,
      dot: true,
      ignore,
    });

    for (const match of matches.sort()) {
      if (!modulesByName.has(match)) {
        modulesByName.set(match, {
          name: match,
          absolutePath: resolve(config.configDir, match),
          size: 0,
          type,
        });
      }
    }
  }

  if (config.uploadSourceMaps) {
    const maps = await globby("**/*.map", {
      cwd: config.configDir,
      onlyFiles: true,
      dot: true,
      ignore,
    });
    for (const map of maps.sort()) {
      addSourcemap(modulesByName, config.configDir, map);
    }
  } else {
    for (const name of [...modulesByName.keys()]) {
      const mapName = `${name}.map`;
      if (await pathExists(resolve(config.configDir, mapName))) {
        addSourcemap(modulesByName, config.configDir, mapName);
      }
    }
  }

  const modules = [...modulesByName.values()];
  let totalBytes = 0;
  for (const module of modules) {
    module.size = (await stat(module.absolutePath)).size;
    totalBytes += module.size;
  }

  if (totalBytes > MAX_TOTAL_MODULE_BYTES) {
    throw new InvalidInputError(
      `Worker modules total ${totalBytes} bytes, which exceeds the 40 MB limit for a Base44 deploy.`,
    );
  }

  return modules;
}

function addSourcemap(
  modulesByName: Map<string, WorkerModule>,
  configDir: string,
  name: string,
): void {
  if (modulesByName.has(name)) return;
  modulesByName.set(name, {
    name,
    absolutePath: resolve(configDir, name),
    size: 0,
    type: "sourcemap",
  });
}
