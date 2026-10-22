// oxlint-disable react/only-export-components
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { AuthProvider as OidcAuthProvider, useAuth as useOidcAuth } from 'react-oidc-context'
import { WebStorageStateStore } from 'oidc-client-ts'
import { errorMessage, StoreApiError, verifyAdminSession } from './api'

const authority = import.meta.env.VITE_STOREFRONT_COGNITO_AUTHORITY || ''
const clientId = import.meta.env.VITE_STOREFRONT_COGNITO_CLIENT_ID || ''
const cognitoDomain = import.meta.env.VITE_STOREFRONT_COGNITO_DOMAIN || ''
const configured = Boolean(authority && clientId)
const returnPathKey = 'fieldwork:auth-return-path'
const sessionUserStore = new WebStorageStateStore({ store: window.sessionStorage })
const sessionStateStore = new WebStorageStateStore({ store: window.sessionStorage })

type StoreAuth = {
  configured: boolean
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  accessToken: string | null
  userLabel: string
  error: string
  signIn: (returnPath?: string, forceLogin?: boolean) => Promise<void>
  signOut: () => Promise<void>
}

const StoreAuthContext = createContext<StoreAuth | null>(null)

function accessTokenGroups(token?: string): string[] {
  if (!token) return []
  try {
    const encoded = token.split('.')[1]
    if (!encoded) return []
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(window.atob(padded)) as { 'cognito:groups'?: unknown }
    const groups = payload['cognito:groups']
    if (Array.isArray(groups)) return groups.filter((group): group is string => typeof group === 'string')
    return typeof groups === 'string' ? [groups] : []
  } catch {
    return []
  }
}

function safeReturnPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function isAdminSignIn(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'adminSignIn' in state && state.adminSignIn === true
}

function OidcBridge({ children }: { children: ReactNode }) {
  const auth = useOidcAuth()
  const accessToken = auth.user?.access_token || null
  const requiresAdminVerification = isAdminSignIn(auth.user?.state)
  const [verifiedAdminToken, setVerifiedAdminToken] = useState<string | null>(null)
  const [adminSignInError, setAdminSignInError] = useState('')
  const adminVerificationPending = Boolean(requiresAdminVerification && accessToken && verifiedAdminToken !== accessToken && !adminSignInError)
  const removeUser = auth.removeUser

  useEffect(() => {
    if (!requiresAdminVerification || !accessToken) return
    let active = true
    void verifyAdminSession(accessToken)
      .then(() => { if (active) setVerifiedAdminToken(accessToken) })
      .catch(async (error: unknown) => {
        if (!active) return
        setAdminSignInError(error instanceof StoreApiError && error.status === 403
          ? 'Admin sign in is restricted to approved administrators. Use Customer sign in for your customer account.'
          : errorMessage(error))
        // A failed admin login must not leave a customer session signed in.
        await removeUser()
      })
      .catch(() => { /* The access-denied state stays active if session cleanup fails. */ })
    return () => { active = false }
  }, [accessToken, requiresAdminVerification, removeUser])

  const sessionAllowed = !adminVerificationPending && !adminSignInError
  const profile = auth.user?.profile
  const userLabel = [profile?.email, profile?.preferred_username, profile?.sub]
    .find((value): value is string => typeof value === 'string' && value.length > 0) || 'Signed in'

  const value: StoreAuth = {
    configured: true,
    isLoading: auth.isLoading || adminVerificationPending,
    isAuthenticated: auth.isAuthenticated && sessionAllowed,
    isAdmin: sessionAllowed && accessTokenGroups(accessToken || undefined).includes('store-admin'),
    accessToken: sessionAllowed ? accessToken : null,
    userLabel: sessionAllowed ? userLabel : '',
    error: adminSignInError || auth.error?.message || '',
    signIn: async (returnPath = window.location.pathname, forceLogin = false) => {
      window.sessionStorage.setItem(returnPathKey, returnPath)
      setAdminSignInError('')
      await auth.signinRedirect({
        state: { returnPath, adminSignIn: returnPath === '/admin' || returnPath.startsWith('/admin/') },
        ...(forceLogin ? { prompt: 'login' } : {}),
      })
    },
    signOut: async () => {
      if (!cognitoDomain) {
        await auth.signoutRedirect()
        return
      }
      // Cognito's managed-login sign-out uses /logout with client_id and logout_uri.
      // Clear the local session before navigating away so switching users is safe.
      const logoutUrl = new URL('/logout', cognitoDomain)
      logoutUrl.searchParams.set('client_id', clientId)
      logoutUrl.searchParams.set('logout_uri', `${window.location.origin}/`)
      await auth.removeUser()
      window.location.assign(logoutUrl.toString())
    },
  }

  return <StoreAuthContext.Provider value={value}>{children}</StoreAuthContext.Provider>
}

const unconfiguredAuth: StoreAuth = {
  configured: false,
  isLoading: false,
  isAuthenticated: false,
  isAdmin: false,
  accessToken: null,
  userLabel: '',
  error: '',
  signIn: async () => undefined,
  signOut: async () => undefined,
}

export function StoreAuthProvider({ children }: { children: ReactNode }) {
  if (!configured) {
    return <StoreAuthContext.Provider value={unconfiguredAuth}>{children}</StoreAuthContext.Provider>
  }

  return (
    <OidcAuthProvider
      authority={authority}
      client_id={clientId}
      redirect_uri={`${window.location.origin}/`}
      post_logout_redirect_uri={`${window.location.origin}/`}
      response_type="code"
      scope="openid email profile"
      automaticSilentRenew
      userStore={sessionUserStore}
      stateStore={sessionStateStore}
      onSigninCallback={(user) => {
        const state = user?.state
        const requestedPath = typeof state === 'object' && state !== null && 'returnPath' in state && typeof state.returnPath === 'string'
          ? state.returnPath : window.sessionStorage.getItem(returnPathKey)
        const returnPath = safeReturnPath(requestedPath)
        window.sessionStorage.removeItem(returnPathKey)
        window.history.replaceState({}, document.title, returnPath)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }}
    >
      <OidcBridge>{children}</OidcBridge>
    </OidcAuthProvider>
  )
}

export function useStoreAuth(): StoreAuth {
  const value = useContext(StoreAuthContext)
  if (!value) throw new Error('useStoreAuth must be used inside StoreAuthProvider')
  return value
}

