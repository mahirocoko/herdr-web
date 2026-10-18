export interface IPiScrollBinding {
  fitGeneration: number
  target: {
    paneId: string
    terminalId: string
    expectedMode: 'agent'
    agentSessionId: string
  }
}

// No timer, queue or retry: each threshold crossing owns at most one page.
export class PiScrollGestureOwner {
  private binding: IPiScrollBinding | null = null
  private residual = 0
  private inFlight = false
  private lastDispatch = -Infinity
  private epoch = 0
  constructor(
    private dispatch: (
      binding: IPiScrollBinding,
      direction: 'up' | 'down' | 'latest'
    ) => Promise<void>,
    private now = () => Date.now()
  ) {}
  setBinding(binding: IPiScrollBinding | null) {
    this.binding = binding
    this.residual = 0
    this.epoch++
  }
  resetResidual() {
    this.residual = 0
  }
  scroll(deltaRows: number): boolean {
    if (!this.binding) return false
    if (
      !Number.isFinite(deltaRows) ||
      this.inFlight ||
      this.now() - this.lastDispatch < 300
    ) {
      this.residual = 0
      return true
    }
    if (Math.sign(deltaRows) !== Math.sign(this.residual)) this.residual = 0
    this.residual += deltaRows
    if (Math.abs(this.residual) < 3) return true
    const direction = this.residual > 0 ? 'up' : 'down'
    return this.dispatchDirection(direction)
  }
  latest(): boolean {
    this.residual = 0
    if (!this.binding) return false
    if (this.inFlight) return true
    return this.dispatchDirection('latest')
  }
  private dispatchDirection(direction: 'up' | 'down' | 'latest'): boolean {
    const binding = this.binding
    if (!binding) return false
    this.residual = 0
    this.inFlight = true
    this.lastDispatch = this.now()
    const epoch = this.epoch
    void this.dispatch(binding, direction)
      .catch(() => {
        if (epoch === this.epoch) this.setBinding(null)
      })
      .finally(() => {
        this.inFlight = false
      })
    return true
  }
}
