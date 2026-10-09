import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from 'react-oidc-context'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

const authority = import.meta.env.VITE_COGNITO_AUTHORITY || ''
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID || ''

const oidcConfig = {
  authority,
  client_id: clientId,
  redirect_uri: window.location.origin + '/',
  response_type: 'code',
  scope: 'openid email profile',
  automaticSilentRenew: false,
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname)
  }
}

console.log("🚀 main.tsx initialized, verifying authentication configuration...")

const isAuthConfigured = Boolean(authority && clientId)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isAuthConfigured ? (
        <AuthProvider {...oidcConfig}>
          <App />
        </AuthProvider>
      ) : (
        <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', maxWidth: '500px', width: '100%', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
            <h2 style={{ color: 'var(--accent-red)', marginBottom: '1rem' }}>Configuration Error</h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              Missing required authentication parameters (<code>VITE_COGNITO_AUTHORITY</code> or <code>VITE_COGNITO_CLIENT_ID</code>).
            </p>
            <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '0.9rem' }}>
              Application failed closed to prevent unauthenticated access. Deploy infrastructure using Terraform to generate authentication configuration.
            </p>
          </div>
        </div>
      )}
    </ErrorBoundary>
  </StrictMode>,
)


