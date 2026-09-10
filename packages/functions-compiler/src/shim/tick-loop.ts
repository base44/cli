// Drift-corrected in-memory tick loop for the Actor shim's managed ticker.
//
// Why not alarms? Measured on real DOs (2026-07-21): an alarm-chained ticker
// requesting 33ms delivered median 127ms / p95 212ms — ~7Hz for a 30Hz ask —
// and alarms are an at-least-once durability primitive with ~2s+ retry
// backoff, so one thrown tick freezes a room for seconds. They also cost a
// billed storage write per tick. While the instance is awake this loop drives
// handleTick with setTimeout (zero storage ops per tick); the alarm survives
// as the ~30s WATCHDOG only — resume after eviction, self-heal a dead loop
// (see Actor.onAlarm). Precision from setTimeout, durability from the alarm.
//
// Semi-fixed timestep: each wake runs the tick callback once per elapsed
// interval, capped at `maxCatchup` steps — beyond the cap the remaining debt is
// DROPPED, because a visible hitch beats a burst of catch-up ticks teleporting
// every entity (the slither.io-on-DO lesson).
export class TickLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  private running = false;
  private intervalMs = 0;
  // A run() resuming after stop()+start() must not arm a second, untracked
  // timer — each run() acts only for its own generation.
  private gen = 0;

  constructor(
    /** Runs one tick. Return false to stop the loop (e.g. shouldTick() flipped). */
    private readonly onTick: () => Promise<boolean> | boolean,
    private readonly maxCatchup = 3,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(intervalMs: number): void {
    if (this.running) {
      if (intervalMs === this.intervalMs) return; // idempotent same-cadence start
      // Interval change mid-run: re-anchor. Schedule only when a timer is
      // pending — with none, the in-flight run() owns rescheduling.
      this.intervalMs = intervalMs;
      this.nextAt = Date.now() + intervalMs;
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
        this.schedule();
      }
      return;
    }
    this.running = true;
    this.intervalMs = intervalMs;
    this.nextAt = Date.now() + intervalMs;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.gen++;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.run();
    }, Math.max(0, this.nextAt - Date.now()));
  }

  private async run(): Promise<void> {
    const gen = this.gen;
    this.timer = null;
    let steps = 0;
    while (this.running && this.gen === gen && Date.now() >= this.nextAt && steps < this.maxCatchup) {
      steps++;
      this.nextAt += this.intervalMs;
      // A throw must not kill the loop with `running` stuck true (self-heal
      // trusts isRunning); only a returned false stops it.
      let keep = true;
      try {
        keep = await this.onTick();
      } catch (err) {
        console.error("TickLoop tick threw:", err);
      }
      if (this.gen !== gen) return; // stopped (or stop+restarted) mid-await
      if (!keep) {
        this.stop();
        return;
      }
    }
    if (!this.running || this.gen !== gen) return;
    if (Date.now() >= this.nextAt) this.nextAt = Date.now() + this.intervalMs; // drop debt past the cap
    this.schedule();
  }
}
