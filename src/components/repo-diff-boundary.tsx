// MIT License - Copyright (c) 2026 devswha
// Adapted dc2f11de RenderBoundary; owner-local patch renderer recovery.
import { Component, type ReactNode } from 'react'
import Button from './ui/button.tsx'
interface IProps {
  resetKey: unknown
  children: ReactNode
}
interface IState {
  failed: boolean
  key: unknown
}
export class RepoDiffBoundary extends Component<IProps, IState> {
  override state: IState = { failed: false, key: this.props.resetKey }
  static getDerivedStateFromProps(
    props: IProps,
    state: IState
  ): Partial<IState> | null {
    return props.resetKey !== state.key
      ? { failed: false, key: props.resetKey }
      : null
  }
  static getDerivedStateFromError(): Partial<IState> {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? (
      <div role="alert">
        <p>
          Patch renderer unavailable. Copy the complete patch or retry display.
        </p>
        <Button
          variant="secondary"
          onClick={() => this.setState({ failed: false })}
        >
          Retry display
        </Button>
      </div>
    ) : (
      this.props.children
    )
  }
}
