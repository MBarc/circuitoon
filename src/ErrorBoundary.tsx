// Last-resort catch for render errors, so a bad sheet shows a way out instead of a blank page.
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Circuitoon render error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="crash" role="alert">
        <h1>Something went wrong drawing this sheet.</h1>
        <p>
          <a href="#/">Back to start</a>
          <button type="button" className="cta" onClick={() => window.location.reload()}>Reload</button>
        </p>
      </main>
    )
  }
}
