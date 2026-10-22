import { useEffect, useRef, useState, type ReactNode } from 'react'
import { hasAuthParams, useAuth } from 'react-oidc-context'
import { LoaderCircle, ShieldCheck } from 'lucide-react'

const pendingSsoKey = 'cloudops:storefront-sso-pending'
const storefrontUrl = import.meta.env.VITE_STOREFRONT_URL || 'http://localhost:5173/'
const storefrontAdminUrl = new URL('/admin/orders', storefrontUrl).href
const sharedIdentityConfigured = Boolean(
  import.meta.env.VITE_COGNITO_AUTHORITY && import.meta.env.VITE_COGNITO_CLIENT_ID &&
  import.meta.env.VITE_COGNITO_AUTHORITY === import.meta.env.VITE_STOREFRONT_COGNITO_AUTHORITY &&
  import.meta.env.VITE_COGNITO_CLIENT_ID === import.meta.env.VITE_STOREFRONT_COGNITO_CLIENT_ID,
)

export function StorefrontSession({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error, signinRedirect } = useAuth()
  const [entry] = useState(() => new URLSearchParams(window.location.search).get('sso') === 'storefront')
  const [callback] = useState(() => Boolean(window.sessionStorage.getItem(pendingSsoKey)) && hasAuthParams())
  const started = useRef(false)
  const [startError, setStartError] = useState(false)

  useEffect(() => {
    if (!entry || !sharedIdentityConfigured || isLoading || error || started.current || hasAuthParams()) return
    started.current = true
    window.sessionStorage.setItem(pendingSsoKey, '1')
    // A top-level, no-prompt redirect reuses Cognito's existing managed-login
    // cookie across app origins. It also replaces any previous dashboard user.
    void signinRedirect({ prompt: 'none', state: { source: 'storefront' } }).catch(() => {
      window.sessionStorage.removeItem(pendingSsoKey)
      setStartError(true)
    })
  }, [entry, isLoading, error, signinRedirect])

  useEffect(() => {
    if ((entry || callback) && (error || (callback && isAuthenticated))) {
      window.sessionStorage.removeItem(pendingSsoKey)
      if (error) window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [entry, callback, error, isAuthenticated])

  if (entry && !sharedIdentityConfigured) {
    return <SessionPanel title="Shared admin sign-in is not configured" message="CloudOps must use the same Cognito identity as the Storefront before it can reuse your administrator session." />
  }

  if ((entry || callback) && (error || startError)) {
    return <SessionPanel title="Your administrator session could not be continued" message="Return to the Storefront and sign in as an administrator again. If this repeats, check the shared Cognito callback and API settings." />
  }

  if (entry) {
    return (
      <main className="app-container" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <section className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <LoaderCircle className="spin" size={32} />
          <h2 style={{ color: 'var(--text-primary)' }}>Opening CloudOps</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Continuing your administrator session…</p>
        </section>
      </main>
    )
  }

  return children
}

function SessionPanel({ title, message }: { title: string; message: string }) {
  return (
    <main className="app-container" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
      <section className="glass-panel" style={{ maxWidth: '560px', padding: '2.5rem', textAlign: 'center' }}>
        <ShieldCheck size={40} color="var(--accent-blue)" />
        <h2 style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '1rem 0' }}>{message}</p>
        <a className="btn" href={storefrontAdminUrl}>Return to Storefront admin</a>
      </section>
    </main>
  )
}
