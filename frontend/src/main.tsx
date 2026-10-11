// oxlint-disable react/only-export-components
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider, useAuth } from 'react-oidc-context'
import './index.css'
import App from './App.tsx'
import Store from './Store.tsx'
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
  onSigninCallback: () => window.history.replaceState({}, document.title, window.location.pathname),
}
const isAuthConfigured = Boolean(authority && clientId)

function AuthenticatedRoot() {
  const [page, setPage] = useState<'store' | 'ops'>(() => window.location.hash === '#ops' ? 'ops' : 'store')
  const auth = useAuth()
  useEffect(() => {
    const openOps = () => { setPage('ops'); window.location.hash = 'ops'; window.scrollTo(0, 0) }
    const signIn = () => { void auth.signinRedirect() }
    const onHash = () => setPage(window.location.hash === '#ops' ? 'ops' : 'store')
    window.addEventListener('open-ops-dashboard', openOps)
    window.addEventListener('store-sign-in', signIn)
    window.addEventListener('hashchange', onHash)
    return () => { window.removeEventListener('open-ops-dashboard', openOps); window.removeEventListener('store-sign-in', signIn); window.removeEventListener('hashchange', onHash) }
  }, [auth])
  return page === 'ops'
    ? <><button className="back-to-store" onClick={() => { window.location.hash = ''; setPage('store') }}>← Back to Fieldwork Store</button><App /></>
    : <Store authEnabled={isAuthConfigured} isAuthenticated={auth.isAuthenticated} userLabel={String(auth.user?.profile?.email || '')} onSignIn={() => { void auth.signinRedirect() }} />
}

function PublicRoot() {
  const [page, setPage] = useState<'store' | 'ops'>(() => window.location.hash === '#ops' ? 'ops' : 'store')
  useEffect(() => {
    const openOps = () => { setPage('ops'); window.location.hash = 'ops'; window.scrollTo(0, 0) }
    const onHash = () => setPage(window.location.hash === '#ops' ? 'ops' : 'store')
    window.addEventListener('open-ops-dashboard', openOps)
    window.addEventListener('hashchange', onHash)
    return () => { window.removeEventListener('open-ops-dashboard', openOps); window.removeEventListener('hashchange', onHash) }
  }, [])
  return page === 'ops'
    ? <><button className="back-to-store" onClick={() => { window.location.hash = ''; setPage('store') }}>← Back to Fieldwork Store</button><main className="safe-error-page"><h1>Dashboard sign-in is not configured</h1><p>Set up the Cognito values from Terraform outputs before opening operator metrics.</p></main></>
    : <Store authEnabled={false} isAuthenticated={false} onSignIn={() => {}} />
}

function Root() {
  return isAuthConfigured ? <AuthProvider {...oidcConfig}><AuthenticatedRoot /></AuthProvider> : <PublicRoot />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
