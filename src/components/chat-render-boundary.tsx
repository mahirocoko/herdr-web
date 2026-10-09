import { Component, type ReactNode } from 'react'
import Button from './ui/button.tsx'
interface IChatRenderBoundaryProps {
  children: ReactNode
  onSwitchToStream: () => void
}
// React requires a class for getDerivedStateFromError; one boundary per native turn.
class ChatRenderBoundary extends Component<
  IChatRenderBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="chat-runtime-warning" role="alert">
        <p>
          This recorded message could not be displayed. The native transcript is
          unchanged.
        </p>
        <Button variant="secondary" onClick={this.props.onSwitchToStream}>
          View Terminal
        </Button>
        <Button
          variant="ghost"
          onClick={() => this.setState({ failed: false })}
        >
          Retry display
        </Button>
      </div>
    )
  }
}
export { ChatRenderBoundary }
