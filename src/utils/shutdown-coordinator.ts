/** Coordinate process shutdown so portal and owned-device cleanup finish before exit. */

/** Collect cleanup tasks and coalesce repeated signals without releasing unconfirmed device ownership. */
export class ShutdownCoordinator {
  private readonly tasks = new Set<() => Promise<void>>();
  private closing?: Promise<number>;

  /** Register one subsystem cleanup and return its disposal function. */
  register(task: () => Promise<void>): () => void {
    this.tasks.add(task);
    return () => {
      this.tasks.delete(task);
    };
  }

  /** Run every registered cleanup once; any rejected cleanup makes shutdown unsuccessful. */
  close(): Promise<number> {
    if (!this.closing) {
      this.closing = Promise.allSettled(
        [...this.tasks].map((task) => Promise.resolve().then(task)),
      ).then((results) =>
        results.some((result) => result.status === "rejected") ? 1 : 0,
      );
    }
    return this.closing;
  }
}

const shutdown = new ShutdownCoordinator();
let installed = false;

/** Register process-wide cleanup; signal handling is installed once for all participating subsystems. */
export function registerShutdownTask(task: () => Promise<void>): () => void {
  if (!installed) {
    installed = true;
    let handling = false;
    const handle = () => {
      if (handling) return;
      handling = true;
      // Repeated signals share the same cleanup; the deadline bounds unresponsive transports.
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
      void shutdown.close().then((code) => {
        clearTimeout(deadline);
        process.exit(code);
      });
    };
    process.on("SIGINT", handle);
    process.on("SIGTERM", handle);
  }
  return shutdown.register(task);
}
