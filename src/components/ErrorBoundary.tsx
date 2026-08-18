import React from 'react'

interface Props {
  children: React.ReactNode
  // Changing this value resets the boundary (e.g. selecting a different email).
  resetKey?: unknown
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Catches render/runtime errors in its subtree so one bad item (e.g. a malformed
 * email body) shows an inline fallback instead of blanking the whole app. The
 * error text is shown on purpose — it makes crashes diagnosable in the field.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 text-center gap-3">
          <div className="i-lucide:alert-triangle text-3xl text-[var(--accent-yellow)]" />
          <div className="text-[var(--text-primary)] font-medium">
            Couldn’t display {this.props.label ?? 'this'}
          </div>
          <pre className="max-w-md whitespace-pre-wrap break-words text-xs text-[var(--text-tertiary)]">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="btn-primary px-3 py-1.5 text-xs rounded"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
