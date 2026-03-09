import { EventEmitter } from "node:events";
import { relative } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import debounce from "lodash/debounce";
import { pathExists } from "@/core/utils/fs.js";
import type { Logger } from "../createDevLogger.js";

const WATCH_DEBOUNCE_MS = 300;
const WATCH_QUEUE_DELAY_MS = 500;

interface WatchBase44Events<T extends string> {
  change: [name: T, relativePath: string];
}

export class WatchBase44<T extends string> extends EventEmitter<
  WatchBase44Events<T>
> {
  private entryNames: T[];
  private watchers: Map<T, FSWatcher> = new Map();
  private queueWaitForCreationTimeout: NodeJS.Timeout | null = null;

  constructor(
    private itemsToWatch: Record<T, string>,
    private logger: Logger,
  ) {
    super();
    this.entryNames = Object.keys(itemsToWatch) as T[];
  }

  async start(): Promise<void> {
    if (this.watchers.size > 0) {
      return;
    }
    for (const name of this.entryNames) {
      const targetPath = this.itemsToWatch[name];
      if (await pathExists(targetPath)) {
        this.watchers.set(name, this.watchTarget(name, targetPath));
      }
    }
    this.watchEntries();
  }

  async close(): Promise<void> {
    if (this.queueWaitForCreationTimeout) {
      clearTimeout(this.queueWaitForCreationTimeout);
      this.queueWaitForCreationTimeout = null;
    }
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }
    this.watchers.clear();
  }

  private watchEntries(): void {
    if (this.queueWaitForCreationTimeout) {
      clearTimeout(this.queueWaitForCreationTimeout);
    }
    this.queueWaitForCreationTimeout = setTimeout(async () => {
      for (const name of this.entryNames) {
        const path = this.itemsToWatch[name];
        const watchItem = this.watchers.get(name);
        const exists = await pathExists(path);

        // Chokidar does not fire an event when the root directory it is watching is deleted.
        // The `unlinkDir` event is only triggered for nested directories, not the root.
        // Therefore, I need to watch for the root deletion separately.
        if (!watchItem && exists) {
          this.emit("change", name, path);
          this.watchers.set(name, this.watchTarget(name, path));
        } else if (watchItem && !exists) {
          await watchItem.close();
          this.emit("change", name, path);

          setTimeout(() => {
            // Garbage collecting closed watchers.
            // This needs to happen in the next "tick", so process will not be "stuck".
            // (User wouldn't be able to exit otherwise)
            this.watchers.forEach((watcher, watcherName) => {
              if (watcher.closed) {
                this.watchers.delete(watcherName);
              }
            });
          });
        }
      }
      this.queueWaitForCreationTimeout = null;
      this.watchEntries();
    }, WATCH_QUEUE_DELAY_MS);
  }

  private watchTarget(name: T, targetPath: string): FSWatcher {
    const watcher = watch(targetPath, {
      ignoreInitial: true,
    });
    watcher.on(
      "all",
      debounce(async (_event: string, path: string) => {
        this.emit("change", name, relative(targetPath, path));
      }, WATCH_DEBOUNCE_MS),
    );
    watcher.on("error", (err) => {
      this.logger.error(
        `Watch handler failed for ${targetPath}`,
        err instanceof Error ? err : undefined,
      );
    });
    return watcher;
  }
}
