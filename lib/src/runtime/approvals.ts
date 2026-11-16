import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
export class Approvals {
  private tail: Promise<unknown> = Promise.resolve();
  // Serialize dialogs; approval never gets reused for a changed input.
  async request(ctx: ExtensionContext, title: string, detail: string, signal?: AbortSignal): Promise<boolean> {
    const action = async () => {
      if (!ctx.hasUI || signal?.aborted) return false;
      return (await ctx.ui.select(`${title}\n${detail}`, ['Allow once', 'Deny'], { timeout: 60_000, signal })) === 'Allow once';
    };
    const next = this.tail.then(action, action); this.tail = next.catch(() => {}); return next;
  }
}
