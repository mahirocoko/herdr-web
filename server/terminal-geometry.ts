export interface INativeTerminalGeometry {
  cols: number
  rows: number
}

/** Extract only the exact pane's authoritative character rectangle; never client-fit it. */
export const resolveNativeTerminalGeometry = (
  result: unknown,
  paneId: string
): INativeTerminalGeometry => {
  const response = result as {
    type?: string
    layout?: {
      panes?: { pane_id?: string; rect?: { width?: number; height?: number } }[]
    }
  }
  if (
    response?.type !== 'pane_layout' ||
    !Array.isArray(response.layout?.panes)
  ) {
    throw new Error('Native terminal geometry unavailable')
  }
  const panes = response.layout.panes.filter((pane) => pane.pane_id === paneId)
  if (panes.length !== 1)
    throw new Error('Native terminal geometry target mismatch')
  const cols = panes[0]?.rect?.width
  const rows = panes[0]?.rect?.height
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    typeof cols !== 'number' ||
    typeof rows !== 'number' ||
    cols < 1 ||
    cols > 500 ||
    rows < 1 ||
    rows > 200
  ) {
    throw new Error('Native terminal geometry outside supported bounds')
  }
  return { cols, rows }
}
