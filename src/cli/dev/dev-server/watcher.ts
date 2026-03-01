import { relative } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import debounce from "lodash/debounce";
import { pathExists } from "@/core/utils/fs.js";
import type { Logger } from "../createDevLogger.js";

const WATCH_DEBOUNCE_MS = 300;
const WATCH_QUEUE_DELAY_MS = 500;

type WatchEntryName = "functions";

type WatchEntry = {
  name: WatchEntryName;
  path: string;
};

export class WatchBase44 {
  private watchers: FSWatcher[] = [];
  private queueWaitForCreation: WatchEntry[] = [];
  private queueWaitForCreationTimeout: NodeJS.Timeout | null = null;

  constructor(
    private itemsToWatch: WatchEntry[],
    private onChange: (subfolder: string, path: string) => Promise<void>,
    private logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.watchers.length > 0 || this.queueWaitForCreation.length > 0) {
      return;
    }
    for (const item of this.itemsToWatch) {
      if (await pathExists(item.path)) {
        this.watchers.push(this.watchTarget(item));
      } else {
        this.queueWaitForCreation.push(item);
      }
    }
    this.watchCreationQueue();
  }

  async close(): Promise<void> {
    if (this.queueWaitForCreationTimeout) {
      clearTimeout(this.queueWaitForCreationTimeout);
      this.queueWaitForCreationTimeout = null;
    }
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];
    this.queueWaitForCreation = [];
  }

  private watchCreationQueue(): void {
    if (this.queueWaitForCreationTimeout) {
      clearTimeout(this.queueWaitForCreationTimeout);
    }
    this.queueWaitForCreationTimeout = setTimeout(async () => {
      const toRemove: WatchEntry[] = [];
      for (const entry of this.queueWaitForCreation) {
        if (await pathExists(entry.path)) {
          this.watchers.push(this.watchTarget(entry));
          toRemove.push(entry);
        }
      }
      this.queueWaitForCreation = this.queueWaitForCreation.filter(
        (entry) => !toRemove.includes(entry),
      );
      if (this.queueWaitForCreation.length > 0) {
        this.watchCreationQueue();
      } else {
        this.queueWaitForCreationTimeout = null;
      }
    }, WATCH_QUEUE_DELAY_MS);
  }

  private watchTarget(item: WatchEntry): FSWatcher {
    const handler = debounce(async (_event: string, path: string) => {
      try {
        await this.onChange(item.name, relative(item.path, path));
      } catch (err) {
        this.logger.error(
          `Reload failed for ${item.name}`,
          err instanceof Error ? err : undefined,
        );
      }
    }, WATCH_DEBOUNCE_MS);

    const watcher = watch(item.path, {
      ignoreInitial: true,
    });
    watcher.on("all", handler);
    watcher.on("unlinkDir", async (deletedPath) => {
      if (deletedPath !== item.path) {
        return;
      }
      await watcher.close();
      this.queueWaitForCreation.push(item);
      this.watchCreationQueue();

      setTimeout(() => {
        // Garbage collecting closed watchers.
        // This needs to happen in the next "tick", so process will not be "stuck".
        // (User wouldn't be able to exit otherwise)
        this.watchers = this.watchers.filter((watcher) => !watcher.closed);
      });
    });
    watcher.on("error", (err) => {
      this.logger.error(
        `[dev-server] Watch handler failed for ${item.path}`,
        err instanceof Error ? err : undefined,
      );
    });
    return watcher;
  }
}
