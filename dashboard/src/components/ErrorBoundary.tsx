import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Identifier for the panel/view being guarded; shown in the fallback. */
  label?: string
  /** Changing this value resets the boundary (e.g. switching views). */
  resetKey?: unknown
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Per-panel error boundary. A single malformed report or render error is
 * contained to the panel that threw — the rest of the dashboard keeps working
 * instead of white-screening for every viewer. The boundary resets itself when
 * `resetKey` changes so navigating away from a broken view recovers cleanly.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console for the host engineer; never crash the app.
    console.error(`[EMLAB] render error in ${this.props.label ?? 'panel'}:`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel" role="alert" style={{ borderColor: 'var(--fail)' }}>
          <div className="eyebrow" style={{ color: 'var(--fail)' }}>
            Panel error{this.props.label ? ` · ${this.props.label}` : ''}
          </div>
          <h3 className="font-display" style={{ margin: '8px 0 6px', fontSize: 18 }}>
            This panel couldn’t be displayed
          </h3>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13, margin: '0 0 14px', maxWidth: 560 }}>
            A rendering error was contained here so the rest of the dashboard keeps working. This is
            usually a single malformed record — try another view, or reload after a rescan.
          </p>
          <pre
            className="font-mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-dim)',
              background: '#faf8fb',
              border: '1px solid var(--line-bright)',
              borderRadius: 8,
              padding: '10px 12px',
              overflowX: 'auto',
              margin: '0 0 14px',
              whiteSpace: 'pre-wrap',
            }}
          >
            {this.state.error.message}
          </pre>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
