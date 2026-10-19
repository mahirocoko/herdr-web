/** Local fitted-view lifetime only: never sends process signals or stores terminal bytes/input. */
export class TerminalFitPause {
  paused = false;
  private revision = 0;

  pause(release: () => void): void {
    if (this.paused) return;
    this.paused = true;
    this.revision++;
    release();
  }

  resume(attach: () => void): void {
    if (!this.paused) return;
    this.paused = false;
    this.revision++;
    attach();
  }

  reset(): void {
    this.paused = false;
    this.revision++;
  }

  ticket(): () => boolean {
    const revision = this.revision;
    return () => !this.paused && revision === this.revision;
  }
}
