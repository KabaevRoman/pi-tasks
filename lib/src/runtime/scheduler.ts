// A fair lock: readers may batch until a writer is queued. All backend access joins it.
type Waiter = { write: boolean; start: () => void };
export class Scheduler {
  private readers = 0;
  private writer = false;
  private queue: Waiter[] = [];
  async run<T>(write: boolean, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await new Promise<void>(resolve => { this.queue.push({ write, start: resolve }); this.drain(); });
    try { signal?.throwIfAborted(); return await action(); }
    finally { if (write) this.writer = false; else this.readers--; this.drain(); }
  }
  private drain(): void {
    if (this.writer) return;
    while (this.queue.length) {
      const next = this.queue[0];
      if (next.write) {
        if (this.readers) return;
        this.writer = true; this.queue.shift()!.start(); return;
      }
      this.readers++; this.queue.shift()!.start();
    }
  }
}
