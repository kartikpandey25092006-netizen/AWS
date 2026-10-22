// oxlint-disable react/only-export-components
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from 'react-oidc-context'
import { WebStorageStateStore } from 'oidc-client-ts'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import ConstellationGrid from './components/ui/constellation-grid.tsx'
import './index.css'

const authority = import.meta.env.VITE_COGNITO_AUTHORITY || ''
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID || ''
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing CloudOps root element')

function ConfigurationRequired() {
  return (
    <main className="app-container" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
      <section className="glass-panel" style={{ maxWidth: '560px', padding: '2rem' }}>
        <h1>CloudOps sign-in is not configured</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          This operator dashboard has no public mode. Configure the Cognito authority and public app client before signing in.
        </p>
      </section>
    </main>
  )
}

const root = createRoot(rootElement)
if (!authority || !clientId) {
  root.render(<StrictMode><ConstellationGrid /><ConfigurationRequired /></StrictMode>)
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider
          authority={authority}
          client_id={clientId}
          redirect_uri={window.location.origin + '/'}
          post_logout_redirect_uri={window.location.origin + '/'}
          response_type="code"
          scope="openid email profile"
          automaticSilentRenew={false}
          userStore={new WebStorageStateStore({ store: window.sessionStorage })}
          stateStore={new WebStorageStateStore({ store: window.sessionStorage })}
          onSigninCallback={() => window.history.replaceState({}, document.title, window.location.pathname)}
        >
          <ConstellationGrid /><App />
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}
