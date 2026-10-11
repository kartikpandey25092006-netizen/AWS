import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State { return { hasError: true } }

  public render() {
    if (this.state.hasError) {
      return (
        <main className="safe-error-page" role="alert">
          <h1>Something went wrong</h1>
          <p>The page could not load. Refresh to try again.</p>
          <button className="safe-error-button" onClick={() => window.location.reload()}>Refresh page</button>
        </main>
      )
    }
    return this.props.children
  }
}
