/** Retired producer entrypoint. Kept as a non-writing migration notice for explicit
 * launch references. The configured mahiro-pi worker-activity resource is the sole
 * producer for both old Herdr and Herdr App/core. No timers, receipts or child tools.
 */
interface PiObserverApi {
  registerCommand(name: string, command: {
    description: string;
    handler(args: string, ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }): Promise<void>;
  }): void;
}
export default function retiredPiObserver(pi: PiObserverApi): void {
  pi.registerCommand("herdr-web-observer", {
    description: "Retired observer: use the one-time configured mahiro-pi integration",
    async handler(_args, ctx) {
      ctx.ui.notify("This observer no longer publishes. Configure mahiro-pi's worker-activity resource and private herdr-web.json target once for both runtimes; see INSTALL.md. No per-session start is required.", "warning");
    },
  });
}
