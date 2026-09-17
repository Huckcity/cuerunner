import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// The whole show lives in one React tree, so a render error would otherwise leave an
// empty window with no way back. Reloading is the cheapest recovery, and it is honest:
// the workspace on disk is untouched, and whatever the autosave snapshot caught is
// offered back once the window is up again — the rest is gone.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Interface error:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash-screen" role="alert">
        <h1 className="crash-screen-title">Cuerunner hit an error it could not recover from</h1>
        <p className="crash-screen-body">
          The workspace file on disk is untouched. Work the autosave caught is offered back once
          the window reloads; anything since the last autosave is gone.
        </p>
        <pre className="crash-screen-message">{error.message}</pre>
        <button className="crash-screen-reload" onClick={() => window.location.reload()}>
          Reload Cuerunner
        </button>
      </div>
    )
  }
}
